/**
 * The booking reference must actually reach the patient's eyes.
 *
 * Since the September 2026 security fix the backend refuses a reschedule or
 * a cancellation that does not carry the booking reference, and
 * POST /api/appointments/lookup needs phone + reference. The card was
 * already SENDING the reference on its own buttons, which made the in-page
 * flow look fine while the patient was never actually given the thing —
 * close the tab and the appointment can only be changed by phoning the
 * clinic. A test that only exercised the buttons would have stayed green
 * through exactly that failure, so these assert what is rendered.
 *
 * Synthetic data only: invented name, 555 reserved range.
 */

import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';
import ConfirmationCard from './ConfirmationCard';

const CLINIC = {
  name: 'SmileVerse Dental',
  phone: '+1-555-0100',
  address: '123 Dental Lane, Smile City, SC 12345',
};

const APPOINTMENT = {
  _id: 'appt-synthetic-1',
  service: 'Cleaning',
  date: '2026-09-17',
  time: '12:30 PM',
  bookingReference: 'K7M2QX9RT4',
};

function renderCard(appointment = APPOINTMENT) {
  return render(
    <LanguageProvider>
      <ConfirmationCard appointment={appointment} clinic={CLINIC} durationMinutes={45} />
    </LanguageProvider>
  );
}

test('shows the booking reference on the confirmation card', () => {
  renderCard();
  expect(screen.getByText('K7M2QX9RT4')).toBeInTheDocument();
});

test('tells the patient to keep it and what it is for', () => {
  renderCard();
  // Not asserting the exact sentence — asserting that the card explains the
  // reference is needed later, so the copy can be reworded without the test
  // silently permitting its removal.
  expect(screen.getByText(/change or cancel/i)).toBeInTheDocument();
});

test('renders nothing extra for an appointment booked before the fix', () => {
  // Appointments created before this deploy have no reference at all. The
  // card must not print an empty box or the word "undefined" for them.
  const { container } = renderCard({ ...APPOINTMENT, bookingReference: undefined });
  expect(container.querySelector('.sv-confirmation-reference')).toBeNull();
  expect(screen.queryByText(/undefined/i)).toBeNull();
});
