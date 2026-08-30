import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';

/** Turn '2026-09-01' + '10:30 AM' into a Date, defaulting to a 30-min duration if needed. */
function parseAppointmentDate(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [time, ampm] = timeStr.split(' ');
  let [h, m] = time.split(':').map(Number);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(h, m || 0, 0, 0);
  return d;
}

function toGoogleCalendarDateParam(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function buildGoogleCalendarUrl({ appointment, clinic, durationMinutes = 30 }) {
  const start = parseAppointmentDate(appointment.date, appointment.time);
  if (!start) return null;
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${appointment.service} at ${clinic.name}`,
    dates: `${toGoogleCalendarDateParam(start)}/${toGoogleCalendarDateParam(end)}`,
    details: `Appointment for ${appointment.service} at ${clinic.name}. Phone: ${clinic.phone}`,
    location: clinic.address || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function ConfirmationCard({ appointment, clinic, durationMinutes, onReschedule, onCancel, showMockNotice = true }) {
  const { t } = useLanguage();
  const calendarUrl = buildGoogleCalendarUrl({ appointment, clinic, durationMinutes });

  return (
    <div className="sv-card sv-confirmation-card">
      <div className="sv-confirmation-badge">✓</div>
      <h3>{t.booking.confirmedTitle}</h3>
      <div className="sv-confirmation-details">
        <div className="sv-confirmation-row">
          <span className="sv-confirmation-label">{appointment.service}</span>
        </div>
        <div className="sv-confirmation-row sv-confirmation-meta">
          <span>📅 {appointment.date}</span>
          <span>🕐 {appointment.time}</span>
          {durationMinutes ? <span>⏱ {durationMinutes} mins</span> : null}
        </div>
        <div className="sv-confirmation-row sv-confirmation-meta">
          <span>📍 {clinic.address}</span>
        </div>
        <div className="sv-confirmation-row sv-confirmation-meta">
          <span>📞 {clinic.phone}</span>
        </div>
      </div>

      <div className="sv-confirmation-actions">
        {calendarUrl && (
          <a className="sv-btn sv-btn-confirm sv-btn-small" href={calendarUrl} target="_blank" rel="noreferrer">
            {t.booking.addToCalendar}
          </a>
        )}
        {onReschedule && (
          <button type="button" className="sv-btn sv-btn-outline sv-btn-small" onClick={onReschedule}>
            {t.booking.reschedule}
          </button>
        )}
        {onCancel && (
          <button type="button" className="sv-btn sv-btn-danger sv-btn-small" onClick={onCancel}>
            {t.booking.cancel}
          </button>
        )}
      </div>

      {showMockNotice && <p className="sv-mock-notice">{t.booking.mockNotice}</p>}
    </div>
  );
}

export default ConfirmationCard;
