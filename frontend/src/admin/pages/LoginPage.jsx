import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAdminAuth } from '../AdminAuthContext';

/**
 * States (Phase 3 §2): loading, invalid credentials, account disabled,
 * server error, successful login. Every one of these maps to a distinct
 * message rather than a generic "something went wrong" — the backend
 * (routes/adminAuth.js) already returns a distinguishable status/message
 * for each, this just renders it.
 */
export default function LoginPage() {
  const { login } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState('idle'); // idle | loading | error
  const [errorMessage, setErrorMessage] = useState('');

  const redirectTo = location.state?.from || '/admin';

  async function handleSubmit(e) {
    e.preventDefault();
    setState('loading');
    setErrorMessage('');
    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setState('error');
      // err.message already carries the right distinction (invalid vs
      // disabled vs rate-limited vs server error) from adminApi's request()
      // helper, which surfaces the backend's own error text.
      setErrorMessage(err.message || 'Something went wrong. Please try again.');
    }
  }

  return (
    <div className="admin-login-page">
      <div className="admin-login-card">
        <h1>SmileVerse Admin</h1>
        <p className="admin-login-subtitle">Sign in to manage your practice.</p>

        {state === 'error' && <div className="admin-alert admin-alert-error">{errorMessage}</div>}

        <form onSubmit={handleSubmit}>
          <div className="admin-field">
            <label htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={state === 'loading'}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={state === 'loading'}
            />
          </div>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={state === 'loading'}>
            {state === 'loading' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
