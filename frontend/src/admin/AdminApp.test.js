import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdminApp from './AdminApp';

/**
 * Mocks `fetch` directly (adminApi.js's request() calls it) rather than
 * mocking the adminApi module — this exercises the real request/response
 * handling (credentials:'include', error message extraction) the same
 * way the real backend would be hit, matching this project's existing
 * preference for testing real logic over mocking it away.
 */
function mockFetchSequence(responses) {
  let call = 0;
  global.fetch = jest.fn(() => {
    const config = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve({
      ok: config.status >= 200 && config.status < 300,
      status: config.status,
      json: () => Promise.resolve(config.body),
    });
  });
}

function renderAdminApp(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('PROTECTED ROUTES: an unauthenticated visitor to /admin is redirected to the login page', async () => {
  mockFetchSequence([{ status: 401, body: { error: 'Not authenticated.' } }]);
  renderAdminApp('/admin');
  await waitFor(() => expect(screen.getByRole('heading', { name: /smileverse admin/i })).toBeInTheDocument());
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
});

test('LOGIN: invalid credentials shows the backend\'s error message, not a generic one', async () => {
  mockFetchSequence([
    { status: 401, body: { error: 'Not authenticated.' } }, // initial /admin/me check
    { status: 401, body: { error: 'Invalid email or password.' } }, // the login attempt
  ]);
  renderAdminApp('/admin/login');
  await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'wrong@x.com' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong-password' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument());
});

test('LOGIN: a disabled account shows the disabled-account message', async () => {
  mockFetchSequence([
    { status: 401, body: { error: 'Not authenticated.' } },
    { status: 403, body: { error: 'This account has been disabled. Contact your practice administrator.' } },
  ]);
  renderAdminApp('/admin/login');
  await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'dana@a.com' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'whatever' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => expect(screen.getByText(/account has been disabled/i)).toBeInTheDocument());
});

test('LOGIN: successful login reaches the dashboard and renders real (zeroed) data, not fabricated numbers', async () => {
  const overview = {
    demoMode: true,
    practiceName: 'SmileVerse Dental',
    today: { date: '2026-08-30', appointments: 0 },
    upcomingAppointments: 0,
    newLeads: 0,
    totalLeads: 0,
    conversations: 0,
    pendingHandoffs: 0,
    totalHandoffs: 0,
    cancellations: 0,
    reschedules: 0,
    totalAppointmentsBooked: 0,
  };
  mockFetchSequence([
    { status: 401, body: { error: 'Not authenticated.' } }, // initial /admin/me check -> anonymous
    { status: 200, body: { success: true, admin: { id: 'a1', name: 'Alice', email: 'alice@a.com', role: 'practice_admin', practiceId: 'practice-a' } } }, // login
    { status: 200, body: overview }, // dashboard overview after redirect
  ]);
  renderAdminApp('/admin/login');
  await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'alice@a.com' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'correct-password' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => expect(screen.getByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument());
  // "Demo Mode is on" banner reflects the real demoMode flag from the API, not something hard-coded.
  expect(screen.getByText(/demo mode is on/i)).toBeInTheDocument();
  // A zero-state metric renders as an actual "0", never invented data.
  expect(screen.getAllByText('0').length).toBeGreaterThan(0);
});
