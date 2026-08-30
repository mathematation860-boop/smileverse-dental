import React from 'react';

export function LoadingState({ label = 'Loading…' }) {
  return <div className="admin-loading">{label}</div>;
}

export function ErrorState({ message }) {
  return <div className="admin-alert admin-alert-error">{message || 'Something went wrong. Please try again.'}</div>;
}

export function EmptyState({ children }) {
  return <div className="admin-empty-state">{children}</div>;
}

/** Requirement #15: Demo Mode must be clearly labelled wherever it applies. */
export function DemoModeBanner({ demoMode }) {
  if (!demoMode) return null;
  return (
    <div className="admin-alert admin-alert-info">
      <strong>Demo Mode is on.</strong> This practice is using the simulated appointment/calendar system — no real Google
      Calendar events are created, and nothing here is sent to a live patient.
    </div>
  );
}
