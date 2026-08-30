/**
 * Template system tests (Phase 5 spec §12/§13/§14/§27): practice-aware
 * (never hard-coded practice name), sanitized (no executable HTML/JS
 * survives), and language-selectable (en/ur), falling back safely.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const templates = require('../services/notifications/templates');

const VARS = {
  practiceName: 'Bright Smiles Clinic',
  patientName: 'Sarah',
  serviceName: 'Cleaning',
  appointmentDate: 'Tuesday, September 8',
  appointmentTime: '2:00 PM',
  practicePhone: '+1-555-000-1111',
  practiceEmail: 'hello@brightsmiles.example',
};

test('appointment_confirmation SMS is practice-aware — no hard-coded "SmileVerse Dental" anywhere', () => {
  const { body } = templates.render('appointment_confirmation', 'sms', VARS, 'en');
  assert.match(body, /Bright Smiles Clinic/);
  assert.doesNotMatch(body, /SmileVerse/i);
  assert.match(body, /Sarah/);
  assert.match(body, /Tuesday, September 8/);
  assert.match(body, /2:00 PM/);
  assert.match(body, /Cleaning/);
});

test('appointment_confirmation email renders subject/text/html, all practice-aware', () => {
  const { subject, text, html } = templates.render('appointment_confirmation', 'email', VARS, 'en');
  assert.match(subject, /Bright Smiles Clinic/);
  assert.match(text, /Cleaning/);
  assert.match(html, /<div/);
  assert.match(html, /Cleaning/);
});

test('Urdu language variant is used when requested and available', () => {
  const { body } = templates.render('appointment_confirmation', 'sms', VARS, 'ur');
  assert.match(body, /Bright Smiles Clinic/); // variable substitution still happens
  assert.notEqual(body, templates.render('appointment_confirmation', 'sms', VARS, 'en').body);
});

test('an unsupported language falls back to English rather than throwing', () => {
  const { body } = templates.render('human_handoff', 'sms', { ...VARS, handoffReason: 'billing question', practicePhone2: '+1555' }, 'ur');
  assert.match(body, /Bright Smiles Clinic/);
});

test('sanitization: a <script> tag in a patient-supplied variable never survives into the rendered output', () => {
  const malicious = { ...VARS, patientName: '<script>alert(1)</script>Sarah' };
  const { body } = templates.render('appointment_confirmation', 'sms', malicious, 'en');
  assert.doesNotMatch(body, /<script/i);

  const { html } = templates.render('appointment_confirmation', 'email', malicious, 'en');
  assert.doesNotMatch(html, /<script/i);
});

test('sanitization: HTML injected via a variable is escaped in the email HTML body, never rendered as markup', () => {
  const malicious = { ...VARS, patientName: '<img src=x onerror=alert(1)>' };
  const { html } = templates.render('appointment_confirmation', 'email', malicious, 'en');
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /onerror=/i);
});

test('an unknown placeholder never leaks raw {{...}} template syntax into patient-facing text', () => {
  const { body } = templates.render('appointment_confirmation', 'sms', { patientName: 'Sarah' }, 'en');
  assert.doesNotMatch(body, /\{\{/);
});

test('an unknown template type throws rather than silently sending something wrong', () => {
  assert.throws(() => templates.render('not_a_real_type', 'sms', VARS, 'en'));
});
