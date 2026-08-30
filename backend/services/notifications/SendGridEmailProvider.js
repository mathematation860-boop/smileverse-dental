const EmailProvider = require('./EmailProvider');

/**
 * Real email adapter using SendGrid's HTTP API (Phase 5 spec §22). SendGrid
 * was chosen over adding an SMTP library because it needs zero new npm
 * dependencies — this uses Node's built-in global `fetch` (Node 18+, which
 * this project already targets) to call SendGrid's REST API directly,
 * exactly the same "no invented credentials, no new dependency for a
 * feature nothing yet needs live" spirit as the rest of this codebase's
 * provider adapters.
 *
 * Written and wired end-to-end, but — like every other real provider in
 * this codebase — only ever SELECTED for a practice with BOTH
 * `demoMode: false` AND `integrations.emailProvider: 'sendgrid'` (see
 * ./index.js). No practice ships with those set today, and this class has
 * never sent a real email — see the Phase 5 report. `isConfigured()`
 * checks the actual env vars at call time, never assumes.
 */
class SendGridEmailProvider extends EmailProvider {
  constructor({
    apiKey = process.env.SENDGRID_API_KEY,
    fromEmail = process.env.SENDGRID_FROM_EMAIL,
    fromName = process.env.SENDGRID_FROM_NAME,
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
    this.fromName = fromName;
  }

  get providerName() {
    return 'sendgrid';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.fromEmail);
  }

  async send({ to, subject, text, html }) {
    if (!this.isConfigured()) {
      return {
        success: false,
        simulated: false,
        providerMessageId: null,
        providerStatus: null,
        failureReason: 'sendgrid_not_configured',
      };
    }

    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: this.fromEmail, name: this.fromName || undefined },
      subject,
      content: [
        { type: 'text/plain', value: text || stripTags(html || '') },
        ...(html ? [{ type: 'text/html', value: html }] : []),
      ],
    };

    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      // SendGrid returns 202 with no body on success, and its own
      // X-Message-Id header as the real provider message id — never
      // invented, only ever the vendor's own value.
      if (res.status === 202) {
        return {
          success: true,
          simulated: false,
          providerMessageId: res.headers.get('x-message-id') || null,
          providerStatus: 'accepted',
          failureReason: null,
        };
      }

      let failureReason = `sendgrid_http_${res.status}`;
      try {
        const body = await res.json();
        const firstError = body?.errors?.[0]?.message;
        if (firstError && res.status === 400 && /invalid/i.test(firstError)) {
          failureReason = 'invalid_email';
        }
      } catch (e) {
        // no/invalid JSON body — keep the generic http-status failure reason
      }
      return { success: false, simulated: false, providerMessageId: null, providerStatus: String(res.status), failureReason };
    } catch (err) {
      // Network-level failure (DNS, timeout, connection refused) — a
      // genuinely temporary condition, safe to retry.
      return { success: false, simulated: false, providerMessageId: null, providerStatus: null, failureReason: 'network_error' };
    }
  }
}

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, '');
}

module.exports = SendGridEmailProvider;
