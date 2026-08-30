import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { trackEvent, EVENTS } from '../services/analytics';
import { useLanguage } from '../i18n/LanguageContext';
import { BOOKING_REASONS } from '../config/defaultPracticeConfig';
import MiniCalendar from './MiniCalendar';
import ConfirmationCard from './ConfirmationCard';

const STEPS = ['patientType', 'reason', 'date', 'time', 'details', 'confirm'];

// Reason ids that map directly onto a priced backend service; anything not
// listed here (like "Tooth Pain") isn't a fixed-price line item — the
// clinic prices it after evaluation, same as Emergency/Other.
const REASON_TO_SERVICE_ID = {
  cleaning: 'cleaning',
  consultation: 'consultation',
  filling: 'filling',
  root_canal: 'root_canal',
  whitening: 'whitening',
  extraction: 'extraction',
  crown: 'crown',
  emergency: 'emergency',
  other: 'other',
};

/** Best-effort match of free text like "tomorrow" / "Friday" against known open dates. */
function resolveDatePreference(text, openDates) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const today = new Date(new Date().toDateString());

  if (lower.includes('today')) {
    const str = today.toISOString().slice(0, 10);
    return openDates.includes(str) ? str : null;
  }
  if (lower.includes('tomorrow')) {
    const t = new Date(today);
    t.setDate(t.getDate() + 1);
    const str = t.toISOString().slice(0, 10);
    return openDates.includes(str) ? str : null;
  }
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const namedDay = weekdays.findIndex((w) => lower.includes(w));
  if (namedDay >= 0) {
    const match = openDates.find((d) => new Date(`${d}T00:00:00`).getDay() === namedDay);
    return match || null;
  }
  return null;
}

function BookingFlow({ practiceConfig, prefill, onClose, onBooked, conversationId }) {
  const { t } = useLanguage();
  const [stepIndex, setStepIndex] = useState(0);
  const [patientType, setPatientType] = useState(prefill?.patientType || null);
  const [reasonId, setReasonId] = useState(prefill?.serviceId || null);
  const [openDates, setOpenDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedTime, setSelectedTime] = useState(null);
  const [details, setDetails] = useState({ name: '', phone: '', email: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bookedAppointment, setBookedAppointment] = useState(null);

  const step = STEPS[stepIndex];

  const reason = useMemo(() => BOOKING_REASONS.find((r) => r.id === reasonId), [reasonId]);
  const serviceMeta = useMemo(() => {
    const serviceId = REASON_TO_SERVICE_ID[reasonId];
    return practiceConfig.services?.find((s) => s.id === serviceId) || null;
  }, [reasonId, practiceConfig.services]);

  useEffect(() => {
    trackEvent(EVENTS.APPOINTMENT_REQUESTED, conversationId, { serviceId: reasonId });
    api
      .getAvailableDates(60)
      .then((data) => {
        setOpenDates(data.dates || []);
        const resolved = resolveDatePreference(prefill?.datePreference, data.dates || []);
        if (resolved) setSelectedDate(resolved);
      })
      .catch(() => setOpenDates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    setLoadingSlots(true);
    setSelectedTime(null);
    api
      .getAvailability(selectedDate)
      .then((data) => setSlots(data.slots || []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [selectedDate]);

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const canProceed = () => {
    if (step === 'patientType') return !!patientType;
    if (step === 'reason') return !!reasonId;
    if (step === 'date') return !!selectedDate;
    if (step === 'time') return !!selectedTime;
    if (step === 'details') return details.name.trim() && details.phone.trim();
    return true;
  };

  const submitBooking = async () => {
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        name: details.name.trim(),
        phone: details.phone.trim(),
        email: details.email.trim() || undefined,
        service: reason?.name || 'Other',
        serviceId: REASON_TO_SERVICE_ID[reasonId] || null,
        patientType,
        reason: reason?.name,
        date: selectedDate,
        time: selectedTime,
        isEmergency: reasonId === 'emergency',
        conversationId,
      };
      const res = await api.bookAppointment(payload);
      setBookedAppointment(res.data);
      onBooked && onBooked(res.data);
      setStepIndex(STEPS.length - 1);
    } catch (err) {
      setError(err.message || 'Something went wrong booking your appointment.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (step === 'confirm' && !bookedAppointment && !submitting && !error) {
      submitBooking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <div className="sv-modal-overlay" role="dialog" aria-modal="true">
      <div className="sv-modal sv-booking-modal">
        <div className="sv-modal-header">
          <h3>{t.booking.title}</h3>
          <button type="button" className="sv-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {step !== 'confirm' && (
          <div className="sv-booking-progress">
            {STEPS.slice(0, -1).map((s, i) => (
              <span key={s} className={`sv-progress-dot ${i <= stepIndex ? 'sv-progress-dot-active' : ''}`} />
            ))}
          </div>
        )}

        <div className="sv-modal-body">
          {step === 'patientType' && (
            <div className="sv-step">
              <p className="sv-step-label">{t.booking.stepPatientType}</p>
              <div className="sv-choice-grid">
                <button
                  type="button"
                  className={`sv-choice-btn ${patientType === 'new' ? 'sv-choice-active' : ''}`}
                  onClick={() => setPatientType('new')}
                >
                  {t.booking.newPatient}
                </button>
                <button
                  type="button"
                  className={`sv-choice-btn ${patientType === 'existing' ? 'sv-choice-active' : ''}`}
                  onClick={() => setPatientType('existing')}
                >
                  {t.booking.existingPatient}
                </button>
              </div>
            </div>
          )}

          {step === 'reason' && (
            <div className="sv-step">
              <p className="sv-step-label">{t.booking.stepReason}</p>
              <div className="sv-choice-grid sv-choice-grid-wrap">
                {BOOKING_REASONS.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={`sv-choice-btn ${reasonId === r.id ? 'sv-choice-active' : ''} ${r.id === 'emergency' ? 'sv-choice-emergency' : ''}`}
                    onClick={() => setReasonId(r.id)}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
              {serviceMeta && (
                <p className="sv-step-hint">
                  {serviceMeta.price != null ? `$${serviceMeta.price} · ${serviceMeta.duration} mins` : 'Priced after evaluation'}
                </p>
              )}
            </div>
          )}

          {step === 'date' && (
            <div className="sv-step">
              <p className="sv-step-label">{t.booking.stepDate}</p>
              <MiniCalendar openDates={openDates} selectedDate={selectedDate} onSelect={setSelectedDate} />
            </div>
          )}

          {step === 'time' && (
            <div className="sv-step">
              <p className="sv-step-label">{t.booking.stepTime}</p>
              {loadingSlots && <p className="sv-loading-text">{t.chat.loadingAvailability}</p>}
              {!loadingSlots && slots.length === 0 && <p className="sv-step-hint">{t.booking.noSlots}</p>}
              <div className="sv-slot-grid">
                {slots.map((s) => (
                  <button
                    type="button"
                    key={s.time}
                    className={`sv-slot-btn ${selectedTime === s.time ? 'sv-choice-active' : ''}`}
                    onClick={() => setSelectedTime(s.time)}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 'details' && (
            <div className="sv-step">
              <p className="sv-step-label">{t.booking.stepDetails}</p>
              <input
                type="text"
                placeholder={t.booking.fullName}
                value={details.name}
                onChange={(e) => setDetails({ ...details, name: e.target.value })}
              />
              <input
                type="text"
                placeholder={t.booking.phone}
                value={details.phone}
                onChange={(e) => setDetails({ ...details, phone: e.target.value })}
              />
              <input
                type="email"
                placeholder={t.booking.email}
                value={details.email}
                onChange={(e) => setDetails({ ...details, email: e.target.value })}
              />
            </div>
          )}

          {step === 'confirm' && (
            <div className="sv-step">
              {submitting && <p className="sv-loading-text">{t.chat.loadingConfirmation}</p>}
              {error && (
                <div className="sv-error-box">
                  <p>{error}</p>
                  <button type="button" className="sv-btn sv-btn-confirm sv-btn-small" onClick={submitBooking}>
                    {t.booking.confirmButton}
                  </button>
                </div>
              )}
              {bookedAppointment && (
                <ConfirmationCard
                  appointment={bookedAppointment}
                  clinic={practiceConfig}
                  durationMinutes={serviceMeta?.duration}
                  onCancel={onClose}
                />
              )}
            </div>
          )}
        </div>

        {step !== 'confirm' && (
          <div className="sv-modal-footer">
            <button type="button" className="sv-btn sv-btn-outline" onClick={stepIndex === 0 ? onClose : goBack}>
              {t.booking.back}
            </button>
            <button type="button" className="sv-btn sv-btn-confirm" disabled={!canProceed()} onClick={goNext}>
              {t.booking.next}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default BookingFlow;
