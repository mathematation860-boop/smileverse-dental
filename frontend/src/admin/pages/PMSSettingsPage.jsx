import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState } from '../components/StatusStates';

const STATUS_LABEL = {
  not_enabled: 'Not Enabled',
  demo: 'Demo Mode',
  not_connected: 'Not Connected',
  connected: 'Connected',
};

const STATUS_CLASS = {
  not_enabled: 'admin-alert-info',
  demo: 'admin-alert-info',
  not_connected: 'admin-alert-error',
  connected: 'admin-alert-success',
};

function mappingToText(mapping) {
  return JSON.stringify(mapping || {}, null, 2);
}

export default function PMSSettingsPage() {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [mappingText, setMappingText] = useState({ serviceMappings: '{}', providerMappings: '{}', operatoryMappings: '{}' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([adminApi.getPmsStatus(), adminApi.getPmsSettings()])
      .then(([s, settingsData]) => {
        if (cancelled) return;
        setStatus(s);
        setSettings(settingsData);
        setMappingText({
          serviceMappings: mappingToText(settingsData.serviceMappings),
          providerMappings: mappingToText(settingsData.providerMappings),
          operatoryMappings: mappingToText(settingsData.operatoryMappings),
        });
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await adminApi.testPmsConnection();
      setTestResult(result);
      const s = await adminApi.getPmsStatus();
      setStatus(s);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    try {
      const parsed = {};
      for (const key of ['serviceMappings', 'providerMappings', 'operatoryMappings']) {
        try {
          parsed[key] = JSON.parse(mappingText[key] || '{}');
        } catch (parseErr) {
          throw new Error(`${key} is not valid JSON.`);
        }
      }
      await adminApi.updatePmsSettings(parsed);
      setSavedAt(Date.now());
      const s = await adminApi.getPmsStatus();
      setStatus(s);
    } catch (err) {
      setSaveError(err.message + (err.body?.details ? `: ${err.body.details.join('; ')}` : ''));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!status || !settings) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Open Dental (PMS)</h1>
          <p>Practice management system connection, appointment-type/provider/operatory mapping, and connection test.</p>
        </div>
      </div>

      <div className={`admin-alert ${STATUS_CLASS[status.status] || 'admin-alert-info'}`}>
        <strong>Status: {STATUS_LABEL[status.status] || status.status}.</strong> {status.statusMessage}
      </div>

      {!status.pmsEnabled && (
        <div className="admin-alert admin-alert-info">
          Open Dental integration is not turned on for this practice. Enabling it is a deliberate configuration change made
          in the practice's own config file (never from this dashboard) — see the Phase 6 report for setup steps.
        </div>
      )}

      <div className="admin-card">
        <h2>Connection</h2>
        <div className="admin-grid">
          <div className="admin-stat-card">
            <div className="admin-stat-label">Provider</div>
            <div className="admin-stat-value" style={{ fontSize: 20 }}>{status.providerName || '—'}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-label">Credentials configured</div>
            <div className="admin-stat-value" style={{ fontSize: 20 }}>{status.providerConfigured ? 'Yes' : 'No'}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-label">Last successful test</div>
            <div className="admin-stat-value" style={{ fontSize: 16 }}>
              {status.lastSuccessfulTestAt ? new Date(status.lastSuccessfulTestAt).toLocaleString() : 'Never'}
            </div>
          </div>
        </div>
        <div className="admin-form-actions" style={{ alignItems: 'center', marginTop: 12 }}>
          <button type="button" className="admin-btn admin-btn-primary" onClick={handleTestConnection} disabled={testing || !status.pmsEnabled}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          {testResult && (
            <span style={{ color: testResult.success ? 'var(--sv-mint-dark)' : 'var(--sv-danger-dark)', fontSize: 13 }}>
              {testResult.success
                ? `Connected (${testResult.latencyMs ?? '?'}ms).`
                : `Failed: ${testResult.error || 'unknown error'}.`}
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--sv-text-muted)', marginTop: 8 }}>
          This test performs a safe, read-only request only — it never creates or modifies a patient or appointment. API
          credentials are never entered here; they are configured server-side by whoever deploys this application (see the
          Phase 6 report's environment variable list) and are never displayed or returned to this dashboard.
        </p>
      </div>

      <div className="admin-card">
        <h2>Appointment-Type / Provider / Operatory Mapping</h2>
        <p style={{ fontSize: 13, color: 'var(--sv-text-muted)' }}>
          Maps this practice's own services and default provider/operatory to Open Dental's numeric IDs. If a service has no
          mapping, the receptionist will honestly tell the patient the clinic needs to confirm that appointment type rather
          than guessing. Currently configured: {status.mappings.serviceMappingCount} service mapping(s),{' '}
          {status.mappings.providerMappingCount} provider mapping(s), {status.mappings.operatoryMappingCount} operatory
          mapping(s).
        </p>
        {['serviceMappings', 'providerMappings', 'operatoryMappings'].map((key) => (
          <div className="admin-field" key={key}>
            <label>{key}</label>
            <textarea
              rows={5}
              style={{ fontFamily: 'monospace', fontSize: 12, width: '100%' }}
              value={mappingText[key]}
              onChange={(e) => setMappingText({ ...mappingText, [key]: e.target.value })}
            />
          </div>
        ))}
        <div className="admin-form-actions" style={{ alignItems: 'center' }}>
          <button type="button" className="admin-btn admin-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saveError && <span style={{ color: 'var(--sv-danger-dark)', fontSize: 13 }}>{saveError}</span>}
          {!saveError && savedAt && <span style={{ color: 'var(--sv-mint-dark)', fontSize: 13 }}>Saved.</span>}
        </div>
      </div>
    </div>
  );
}
