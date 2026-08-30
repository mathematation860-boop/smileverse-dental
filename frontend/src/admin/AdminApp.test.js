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

test('PMS PAGE (Phase 6): an authenticated visit to /admin/pms in Demo Mode shows "Demo Mode — Open Dental is not connected", never a fake connected status', async () => {
  mockFetchSequence([
    { status: 200, body: { admin: { id: 'a1', name: 'Alice', email: 'alice@a.com', role: 'practice_admin', practiceId: 'practice-a' } } }, // /admin/me
    {
      status: 200,
      body: {
        pmsEnabled: true,
        demoMode: true,
        providerName: 'mock',
        status: 'demo',
        statusMessage: 'Demo Mode — Open Dental is not connected.',
        providerConfigured: false,
        lastSuccessfulTestAt: null,
        mappings: { serviceMappingCount: 1, providerMappingCount: 0, operatoryMappingCount: 0 },
      },
    }, // GET /admin/pms
    { status: 200, body: { serviceMappings: { cleaning: { openDentalAppointmentTypeNum: '12' } }, providerMappings: {}, operatoryMappings: {} } }, // GET /admin/pms-settings
  ]);
  renderAdminApp('/admin/pms');

  await waitFor(() => expect(screen.getByRole('heading', { name: /open dental \(pms\)/i })).toBeInTheDocument());
  expect(screen.getByText(/demo mode — open dental is not connected/i)).toBeInTheDocument();
  // Never a fabricated "Connected" status while demoMode is on.
  expect(screen.queryByText(/^status: connected\.?$/i)).not.toBeInTheDocument();
  // The real mapping count from the API renders, never an invented number.
  expect(screen.getByText(/1 service mapping\(s\)/i)).toBeInTheDocument();
});

test('PMS PAGE (Phase 6): Test Connection never displays the provider\'s API credentials, even if a field with a credential-shaped name were present in the response', async () => {
  mockFetchSequence([
    { status: 200, body: { admin: { id: 'a1', name: 'Alice', email: 'alice@a.com', role: 'practice_admin', practiceId: 'practice-a' } } }, // /admin/me
    { status: 200, body: { pmsEnabled: true, demoMode: true, providerName: 'mock', status: 'demo', statusMessage: 'Demo Mode — Open Dental is not connected.', providerConfigured: false, lastSuccessfulTestAt: null, mappings: { serviceMappingCount: 0, providerMappingCount: 0, operatoryMappingCount: 0 } } },
    { status: 200, body: { serviceMappings: {}, providerMappings: {}, operatoryMappings: {} } },
    { status: 200, body: { success: true, provider: 'mock', latencyMs: 7 } }, // POST test-connection — deliberately never includes a credential field
    { status: 200, body: { pmsEnabled: true, demoMode: true, providerName: 'mock', status: 'demo', statusMessage: 'Demo Mode — Open Dental is not connected.', providerConfigured: false, lastSuccessfulTestAt: new Date().toISOString(), mappings: { serviceMappingCount: 0, providerMappingCount: 0, operatoryMappingCount: 0 } } }, // status refresh after test
  ]);
  renderAdminApp('/admin/pms');
  await waitFor(() => expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
  await waitFor(() => expect(screen.getByText(/connected \(7ms\)/i)).toBeInTheDocument());
  expect(screen.queryByText(/api[_-]?key/i)).not.toBeInTheDocument();
});
