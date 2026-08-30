import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState } from '../components/StatusStates';

const TABS = ['General & Hours', 'Services', 'Insurance & FAQs', 'Policies', 'AI Configuration'];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function SaveBar({ saving, savedAt, error, onSave }) {
  return (
    <div className="admin-form-actions" style={{ alignItems: 'center' }}>
      <button type="button" className="admin-btn admin-btn-primary" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
      {error && <span style={{ color: 'var(--sv-danger-dark)', fontSize: 13 }}>{error}</span>}
      {!error && savedAt && <span style={{ color: 'var(--sv-mint-dark)', fontSize: 13 }}>Saved.</span>}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [aiConfig, setAiConfig] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    Promise.all([adminApi.getSettings(), adminApi.getAiConfig()])
      .then(([s, ai]) => {
        setSettings(s);
        setAiConfig(ai);
      })
      .catch((err) => setError(err.message));
  }, []);

  function updateField(path, value) {
    setSettings((prev) => {
      const next = structuredClone(prev);
      let obj = next;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      obj[path[path.length - 1]] = value;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    try {
      if (tab === 4) {
        await adminApi.updateAiConfig(aiConfig);
      } else {
        await adminApi.updateSettings(settings);
      }
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err.message + (err.body?.details ? `: ${err.body.details.join('; ')}` : ''));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!settings || !aiConfig) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Practice Settings</h1>
          <p>Changes here apply only to your practice, and take effect immediately for the AI receptionist too.</p>
        </div>
      </div>

      <div className="admin-tabs">
        {TABS.map((t, i) => (
          <button key={t} className={`admin-tab${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && (
        <div className="admin-card">
          <h2>General information</h2>
          <div className="admin-form-grid">
            <div className="admin-field">
              <label>Practice name</label>
              <input value={settings.name || ''} onChange={(e) => updateField(['name'], e.target.value)} />
            </div>
            <div className="admin-field">
              <label>Tagline</label>
              <input value={settings.tagline || ''} onChange={(e) => updateField(['tagline'], e.target.value)} />
            </div>
            <div className="admin-field">
              <label>Phone</label>
              <input value={settings.phone || ''} onChange={(e) => updateField(['phone'], e.target.value)} />
            </div>
            <div className="admin-field">
              <label>Email</label>
              <input value={settings.email || ''} onChange={(e) => updateField(['email'], e.target.value)} />
            </div>
            <div className="admin-field" style={{ gridColumn: '1 / -1' }}>
              <label>Address</label>
              <input value={settings.address || ''} onChange={(e) => updateField(['address'], e.target.value)} />
            </div>
            <div className="admin-field">
              <label>Website</label>
              <input value={settings.website || ''} onChange={(e) => updateField(['website'], e.target.value)} />
            </div>
            <div className="admin-field">
              <label>Timezone (IANA name)</label>
              <input value={settings.timezone || ''} onChange={(e) => updateField(['timezone'], e.target.value)} placeholder="America/New_York" />
            </div>
          </div>

          <h2 style={{ marginTop: 24 }}>Business hours</h2>
          <div className="admin-form-grid">
            <div className="admin-field">
              <label>Opening time (24h)</label>
              <input value={settings.hours?.openTime || ''} onChange={(e) => updateField(['hours', 'openTime'], e.target.value)} placeholder="09:00" />
            </div>
            <div className="admin-field">
              <label>Closing time (24h)</label>
              <input value={settings.hours?.closeTime || ''} onChange={(e) => updateField(['hours', 'closeTime'], e.target.value)} placeholder="17:00" />
            </div>
            <div className="admin-field">
              <label>Slot length (minutes)</label>
              <input
                type="number"
                value={settings.hours?.slotMinutes || ''}
                onChange={(e) => updateField(['hours', 'slotMinutes'], Number(e.target.value))}
              />
            </div>
          </div>
          <div className="admin-field">
            <label>Open days</label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {WEEKDAY_LABELS.map((label, day) => {
                const openDays = settings.hours?.openDays || [];
                const checked = openDays.includes(day);
                return (
                  <label key={day} style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked ? [...openDays, day] : openDays.filter((d) => d !== day);
                        updateField(['hours', 'openDays'], next);
                      }}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </div>
          <SaveBar saving={saving} savedAt={savedAt} error={saveError} onSave={handleSave} />
        </div>
      )}

      {tab === 1 && (
        <div className="admin-card">
          <h2>Services & prices</h2>
          {(settings.services || []).map((svc, i) => (
            <div className="admin-service-row" key={svc.id || i}>
              <input
                value={svc.name || ''}
                placeholder="Service name"
                onChange={(e) => updateField(['services', i, 'name'], e.target.value)}
              />
              <input
                type="number"
                value={svc.price ?? ''}
                placeholder="Price (blank = quoted after eval)"
                onChange={(e) => updateField(['services', i, 'price'], e.target.value === '' ? null : Number(e.target.value))}
              />
              <input
                type="number"
                value={svc.duration || ''}
                placeholder="Minutes"
                onChange={(e) => updateField(['services', i, 'duration'], Number(e.target.value))}
              />
              <button
                type="button"
                className="admin-btn admin-btn-danger"
                onClick={() => updateField(['services'], settings.services.filter((_, idx) => idx !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() =>
              updateField(
                ['services'],
                [...(settings.services || []), { id: `service_${Date.now()}`, name: '', price: null, duration: 30, description: '', eligiblePatientTypes: ['new', 'existing'] }]
              )
            }
          >
            + Add service
          </button>
          <SaveBar saving={saving} savedAt={savedAt} error={saveError} onSave={handleSave} />
        </div>
      )}

      {tab === 2 && (
        <div className="admin-card">
          <h2>Accepted insurance providers</h2>
          <div className="admin-field">
            <label>Providers (one per line)</label>
            <textarea
              rows={5}
              value={(settings.insurance?.acceptedProviders || []).join('\n')}
              onChange={(e) => updateField(['insurance', 'acceptedProviders'], e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
            />
          </div>
          <div className="admin-field">
            <label>Insurance notes</label>
            <textarea rows={3} value={settings.insurance?.notes || ''} onChange={(e) => updateField(['insurance', 'notes'], e.target.value)} />
          </div>

          <h2 style={{ marginTop: 24 }}>Frequently asked questions</h2>
          <p style={{ color: 'var(--sv-text-muted)', fontSize: 13 }}>
            {(settings.faqs || []).length} categor{(settings.faqs || []).length === 1 ? 'y' : 'ies'}. Editing individual
            questions is available on request — this view is read-only for now.
          </p>
          <SaveBar saving={saving} savedAt={savedAt} error={saveError} onSave={handleSave} />
        </div>
      )}

      {tab === 3 && (
        <div className="admin-card">
          <h2>Cancellation policy</h2>
          <div className="admin-field">
            <textarea
              rows={3}
              value={settings.policies?.cancellationSummary || ''}
              onChange={(e) => updateField(['policies', 'cancellationSummary'], e.target.value)}
            />
          </div>
          <h2>Emergency policy</h2>
          <div className="admin-field">
            <textarea
              rows={3}
              value={settings.policies?.emergencySummary || ''}
              onChange={(e) => updateField(['policies', 'emergencySummary'], e.target.value)}
            />
          </div>
          <div className="admin-alert admin-alert-info">
            This text only changes what patients are TOLD about your emergency policy. It never changes the automatic
            emergency detection itself — that stays a fixed safety rule and can't be edited here.
          </div>
          <SaveBar saving={saving} savedAt={savedAt} error={saveError} onSave={handleSave} />
        </div>
      )}

      {tab === 4 && (
        <div className="admin-card">
          <h2>AI Configuration</h2>
          <p style={{ color: 'var(--sv-text-muted)', fontSize: 13 }}>
            Add practice-specific notes for the AI receptionist to mention — e.g. "we now offer Saturday hours" or "ask about
            our new whitening promotion." This is informational only: it can never disable or override emergency safety
            behavior, which is a fixed rule enforced outside the AI entirely.
          </p>
          <div className="admin-field">
            <label>Custom instructions</label>
            <textarea
              rows={6}
              value={aiConfig.customInstructions || ''}
              onChange={(e) => setAiConfig({ customInstructions: e.target.value })}
              placeholder="e.g. Mention our new hygienist, Sam, who joined this month."
            />
          </div>
          <SaveBar saving={saving} savedAt={savedAt} error={saveError} onSave={handleSave} />
        </div>
      )}
    </div>
  );
}
