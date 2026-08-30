/**
 * Real Open Dental REST API adapter (Phase 6 MVP).
 *
 * HONEST SOURCING NOTE (spec §1/§31): endpoint paths, the auth header
 * shape, and field names below were taken from Open Dental's own public
 * documentation pages (opendental.com/site/apisetup.html,
 * apiappointments.html, apipatients.html, the API Specification PDF) as
 * fetched during this implementation session — NOT invented, and NOT
 * copied from an unofficial tutorial. That said, this adapter has never
 * been run against a real Open Dental account (no credentials exist in
 * this environment — see the Phase 6 report's "what is genuinely live"
 * section), so before any real office is connected, each endpoint used
 * here should be re-verified against that office's own API Developer
 * Portal / the current API Specification PDF, since Open Dental's API
 * surface can change between versions. Every endpoint construction is
 * isolated in its own small method below specifically so a correction is
 * a one-line change, never a rewrite.
 *
 * Endpoints used:
 *   GET    /patients?LName=&FName=&Birthdate=&Phone=&Email=   — patient search (spec §7)
 *   POST   /patients                                          — create patient (spec §8)
 *   GET    /appointments?PatNum={PatNum}                      — a patient's appointments (spec §9)
 *   GET    /appointments/Slots?date=&ProvNum=&OpNum=&lengthMinutes= — open slots (spec §10)
 *   GET    /providers                                         — provider directory (spec §12)
 *   GET    /operatories                                       — operatory directory (spec §13)
 *   GET    /appointmenttypes                                  — appointment-type directory (spec §11; lower confidence — see header note, only used for the optional admin mapping helper, never on the booking critical path)
 *   POST   /appointments                                      — create appointment (spec §14)
 *   PUT    /appointments/{AptNum}                              — reschedule (spec §16)
 *   PUT    /appointments/{AptNum}/Break                         — cancel (spec §15 — Open Dental's own "Broken" status semantic, deliberately NOT a DELETE)
 *
 * Auth: `Authorization: ODFHIR {developerKey}/{customerKey}` on every
 * request. Both keys come from environment variables ONLY
 * (OPENDENTAL_DEVELOPER_KEY / OPENDENTAL_CUSTOMER_KEY) — never from the
 * practice config file, admin dashboard, or database (spec §4/§21: keep
 * secrets server-side, never in the frontend, logs, or a weak storage
 * scheme this app doesn't actually have).
 */

const PMSProvider = require('./PMSProvider');
const {
  PMSUnavailableError,
  PatientCreationFailedError,
  AppointmentNotFoundError,
  BookingFailedError,
  CancellationFailedError,
  RescheduleFailedError,
  SlotUnavailableError,
} = require('./PMSErrors');

const DEFAULT_TIMEOUT_MS = 10000;

class OpenDentalPMSProvider extends PMSProvider {
  constructor({
    apiBaseUrl = process.env.OPENDENTAL_API_BASE_URL || 'https://api.opendental.com/api/v1',
    developerKey = process.env.OPENDENTAL_DEVELOPER_KEY,
    customerKey = process.env.OPENDENTAL_CUSTOMER_KEY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = {}) {
    super();
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.developerKey = developerKey;
    this.customerKey = customerKey;
    this.timeoutMs = timeoutMs;
    this._fetch = fetchImpl;
  }

  get providerName() {
    return 'openDental';
  }

  isConfigured() {
    return Boolean(this.developerKey && this.customerKey);
  }

  _authHeader() {
    return `ODFHIR ${this.developerKey}/${this.customerKey}`;
  }

  /**
   * Low-level request helper. Never returns a fabricated success. Throws
   * PMSUnavailableError for anything that means "we could not get a
   * trustworthy answer at all" (not configured, network error, timeout,
   * auth failure, rate limit, server error) — 2xx/400/404/409 responses
   * are returned to the caller as { status, data } so each public method
   * can translate them into the specific typed error its own operation
   * calls for (spec §22).
   */
  async _request(method, path, { query, body } = {}) {
    if (!this.isConfigured()) {
      throw new PMSUnavailableError('not_configured');
    }
    const url = new URL(this.apiBaseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this._fetch(url.toString(), {
        method,
        headers: {
          Authorization: this._authHeader(),
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      let data = null;
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : null;
      } catch (parseErr) {
        data = null; // malformed response body — treated as "no usable data", never guessed
      }

      if (res.status === 401 || res.status === 403) {
        throw new PMSUnavailableError('auth_failed');
      }
      if (res.status === 429) {
        throw new PMSUnavailableError('rate_limited');
      }
      if (res.status >= 500) {
        throw new PMSUnavailableError('server_error');
      }
      return { status: res.status, data };
    } catch (err) {
      if (err instanceof PMSUnavailableError) throw err;
      if (err.name === 'AbortError') throw new PMSUnavailableError('timeout', err);
      throw new PMSUnavailableError('network_error', err);
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(practice) {
    const start = Date.now();
    if (!this.isConfigured()) {
      return { success: false, provider: this.providerName, latencyMs: 0, apiVersion: null, error: 'PMS_NOT_CONFIGURED' };
    }
    try {
      // A read-only, harmless request that proves auth + reachability
      // without creating or modifying anything (spec §6): asking for at
      // most one patient record.
      const { status } = await this._request('GET', '/patients', { query: { Limit: 1 } });
      return { success: status >= 200 && status < 300, provider: this.providerName, latencyMs: Date.now() - start, apiVersion: null, error: status >= 200 && status < 300 ? null : `unexpected_status_${status}` };
    } catch (err) {
      return { success: false, provider: this.providerName, latencyMs: Date.now() - start, apiVersion: null, error: err.reason || 'unknown' };
    }
  }

  async findPatients(practice, { firstName, lastName, dateOfBirth, phone, email } = {}) {
    const { data } = await this._request('GET', '/patients', {
      query: { FName: firstName, LName: lastName, Birthdate: dateOfBirth, Phone: phone, Email: email },
    });
    const rows = Array.isArray(data) ? data : [];
    return rows.map((p) => ({
      externalPatientId: String(p.PatNum),
      firstName: p.FName,
      lastName: p.LName,
      dateOfBirth: p.Birthdate || null,
      phone: p.WirelessPhone || p.HmPhone || p.WkPhone || null,
      email: p.Email || null,
    }));
  }

  async createPatient(practice, patientData) {
    const { status, data } = await this._request('POST', '/patients', {
      body: {
        FName: patientData.firstName,
        LName: patientData.lastName,
        Birthdate: patientData.dateOfBirth || undefined,
        WirelessPhone: patientData.phone || undefined,
        Email: patientData.email || undefined,
      },
    });
    if (status < 200 || status >= 300 || !data || !data.PatNum) {
      throw new PatientCreationFailedError('PATIENT_CREATION_FAILED');
    }
    return {
      externalPatientId: String(data.PatNum),
      firstName: patientData.firstName,
      lastName: patientData.lastName,
      dateOfBirth: patientData.dateOfBirth || null,
      phone: patientData.phone || null,
      email: patientData.email || null,
    };
  }

  async getPatientAppointments(practice, externalPatientId) {
    const { data } = await this._request('GET', '/appointments', { query: { PatNum: externalPatientId } });
    const rows = Array.isArray(data) ? data : [];
    return rows
      .filter((a) => a.AptStatus !== 'Broken' && a.AptStatus !== 'Deleted')
      .map((a) => this._mapAppointment(a));
  }

  async getProviders(practice) {
    const { data } = await this._request('GET', '/providers', {});
    const rows = Array.isArray(data) ? data : [];
    return rows.map((p) => ({ externalProviderId: String(p.ProvNum), name: [p.FName, p.LName].filter(Boolean).join(' ') || p.Abbr || `Provider ${p.ProvNum}` }));
  }

  async getOperatories(practice) {
    const { data } = await this._request('GET', '/operatories', {});
    const rows = Array.isArray(data) ? data : [];
    return rows.map((o) => ({ externalOperatoryId: String(o.OperatoryNum), name: o.OpName || `Operatory ${o.OperatoryNum}` }));
  }

  async getAppointmentTypes(practice) {
    // Lower confidence endpoint (see file header) — used only by the
    // optional admin mapping helper, never required for booking itself.
    try {
      const { data } = await this._request('GET', '/appointmenttypes', {});
      const rows = Array.isArray(data) ? data : [];
      return rows.map((t) => ({ externalAppointmentTypeId: String(t.AppointmentTypeNum), name: t.AppointmentTypeName || `Type ${t.AppointmentTypeNum}` }));
    } catch (err) {
      return [];
    }
  }

  _mapAppointment(a) {
    const dt = String(a.AptDateTime || '');
    const [date, time] = dt.split(' ');
    return {
      externalAppointmentId: String(a.AptNum),
      externalPatientId: String(a.PatNum),
      date: date || null,
      time: time || null, // 24h "HH:mm:ss" as Open Dental returns it — the orchestration layer normalizes this to this app's own 12-hour label
      providerId: a.ProvNum != null ? String(a.ProvNum) : null,
      operatoryId: a.Op != null ? String(a.Op) : null,
      appointmentTypeId: a.AppointmentTypeNum != null ? String(a.AppointmentTypeNum) : null,
      status: a.AptStatus || 'Scheduled',
    };
  }

  async getAvailability(practice, { date, providerId, operatoryId, lengthMinutes } = {}) {
    const { status, data } = await this._request('GET', '/appointments/Slots', {
      query: { date, ProvNum: providerId, OpNum: operatoryId, lengthMinutes },
    });
    if (status < 200 || status >= 300) return [];
    const rows = Array.isArray(data) ? data : [];
    return rows.map((s) => ({
      startIso: s.DateTimeStart || null,
      endIso: s.DateTimeEnd || null,
      providerId: s.ProvNum != null ? String(s.ProvNum) : (providerId || null),
      operatoryId: s.OpNum != null ? String(s.OpNum) : (operatoryId || null),
    }));
  }

  async createAppointment(practice, appointmentData) {
    const { status, data } = await this._request('POST', '/appointments', {
      body: {
        PatNum: Number(appointmentData.externalPatientId),
        Op: appointmentData.operatoryId != null ? Number(appointmentData.operatoryId) : undefined,
        ProvNum: appointmentData.providerId != null ? Number(appointmentData.providerId) : undefined,
        AptDateTime: `${appointmentData.date} ${appointmentData.time24}:00`,
        AppointmentTypeNum: appointmentData.appointmentTypeId != null ? Number(appointmentData.appointmentTypeId) : undefined,
      },
    });
    if (status === 409) throw new SlotUnavailableError('busy');
    if (status < 200 || status >= 300 || !data || !data.AptNum) {
      throw new BookingFailedError('BOOKING_FAILED');
    }
    return this._mapAppointment(data);
  }

  async updateAppointment(practice, externalAppointmentId, patch) {
    const body = {};
    if (patch.date && patch.time24) body.AptDateTime = `${patch.date} ${patch.time24}:00`;
    if (patch.operatoryId != null) body.Op = Number(patch.operatoryId);
    if (patch.providerId != null) body.ProvNum = Number(patch.providerId);

    const { status, data } = await this._request('PUT', `/appointments/${encodeURIComponent(externalAppointmentId)}`, { body });
    if (status === 404) throw new AppointmentNotFoundError();
    if (status === 409) throw new SlotUnavailableError('busy');
    if (status < 200 || status >= 300) throw new RescheduleFailedError('RESCHEDULE_FAILED');
    return this._mapAppointment(data || { AptNum: externalAppointmentId, ...body });
  }

  async cancelAppointment(practice, externalAppointmentId) {
    const { status, data } = await this._request('PUT', `/appointments/${encodeURIComponent(externalAppointmentId)}/Break`, {
      body: { sendToUnscheduleList: false, breakType: 'Cancelled' },
    });
    if (status === 404) throw new AppointmentNotFoundError();
    if (status < 200 || status >= 300) throw new CancellationFailedError('CANCELLATION_FAILED');
    return this._mapAppointment(data || { AptNum: externalAppointmentId, AptStatus: 'Broken' });
  }
}

module.exports = OpenDentalPMSProvider;
