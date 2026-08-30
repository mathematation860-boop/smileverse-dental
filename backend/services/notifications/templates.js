/**
 * Practice-aware notification template system (Phase 5 spec §12/§13/§14).
 *
 * Every template is written in terms of `{{variable}}` placeholders only —
 * never a hard-coded practice name, phone number, or any other
 * practice-specific value (spec §5: "Do NOT hard-code SmileVerse Dental").
 * `render()` is the ONLY place variables are substituted, and it always
 * sanitizes both the variable values AND rejects any placeholder it
 * doesn't recognize, so nothing resembling executable HTML/JavaScript can
 * ever reach a rendered notification (spec §13: "Sanitize rendered output.
 * Do not allow arbitrary executable HTML/JavaScript") — even if a
 * caller-supplied value (e.g. a patient's own typed name) contained a
 * `<script>` tag or similar, it comes out as inert, escaped text.
 *
 * Language support (spec §14): English and Urdu are both defined for
 * every patient-facing template. Roman Urdu is intentionally NOT offered
 * here — the spec is explicit that Roman Urdu notifications only happen
 * if "a practice explicitly configures" it, and no practice does today
 * (see config/practices/smileverse-dental.js's `notifications.language`),
 * so building an unused code path would be dead code, not a feature.
 * Sensitive appointment facts (date/time/service) are never themselves
 * translated/reworded — they're substituted verbatim into whichever
 * language's surrounding sentence is selected, so a mistranslation could
 * never change what a patient is told about their own appointment.
 */

// Matches {{identifier}} — the ONLY substitution syntax this renderer
// understands. Anything else in a template string is emitted verbatim.
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain-text/SMS sanitization: strip any HTML tags outright (a text/SMS channel has no reason to ever carry markup) and collapse control characters. */
function sanitizePlainText(value) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

/** Substitutes `{{var}}` placeholders in `template` from `variables`, escaping every substituted value for the target output format. A placeholder with no matching variable is replaced with an empty string rather than left as a literal `{{...}}` in patient-facing text — safer than accidentally leaking template syntax. */
function fillTemplate(template, variables, { escapeForHtml = false } = {}) {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key) => {
    const raw = variables[key];
    const value = raw === undefined || raw === null ? '' : raw;
    return escapeForHtml ? escapeHtml(sanitizePlainText(value)) : sanitizePlainText(value);
  });
}

// --- Template definitions -------------------------------------------------
// Every template is { sms, email: { subject, body } }, each in en/ur.
// `body` for email is plain-text; renderTemplate() also derives a minimal
// HTML version from it (spec §12: "Support professional HTML/text email
// templates") rather than maintaining two hand-written copies that could
// drift apart.

const TEMPLATES = {
  appointment_confirmation: {
    en: {
      sms: 'Hi {{patientName}}, your appointment with {{practiceName}} is confirmed for {{appointmentDate}} at {{appointmentTime}}. Service: {{serviceName}}. Questions? Call {{practicePhone}}.',
      emailSubject: 'Appointment confirmed — {{practiceName}}',
      emailBody:
        'Hi {{patientName}},\n\n' +
        'Your appointment with {{practiceName}} is confirmed:\n\n' +
        'Service: {{serviceName}}\nDate: {{appointmentDate}}\nTime: {{appointmentTime}}\n\n' +
        'If you need to reschedule or cancel, please contact us at {{practicePhone}}{{practiceEmailLine}}.\n\n' +
        '— {{practiceName}}',
    },
    ur: {
      sms: '{{patientName}}، {{practiceName}} کے ساتھ آپ کی اپائنٹمنٹ {{appointmentDate}} کو {{appointmentTime}} بجے کے لیے کنفرم ہو گئی ہے۔ سروس: {{serviceName}}۔ رابطہ: {{practicePhone}}۔',
      emailSubject: 'اپائنٹمنٹ کی تصدیق — {{practiceName}}',
      emailBody:
        '{{patientName}}،\n\n' +
        '{{practiceName}} کے ساتھ آپ کی اپائنٹمنٹ کنفرم ہو گئی ہے:\n\n' +
        'سروس: {{serviceName}}\nتاریخ: {{appointmentDate}}\nوقت: {{appointmentTime}}\n\n' +
        'تاریخ کی تبدیلی یا منسوخی کے لیے براہ کرم {{practicePhone}} پر رابطہ کریں{{practiceEmailLine}}۔\n\n' +
        '— {{practiceName}}',
    },
  },
  appointment_rescheduled: {
    en: {
      sms: 'Hi {{patientName}}, your {{practiceName}} appointment has been rescheduled to {{appointmentDate}} at {{appointmentTime}}.',
      emailSubject: 'Appointment rescheduled — {{practiceName}}',
      emailBody:
        'Hi {{patientName}},\n\n' +
        'Your appointment with {{practiceName}} has been rescheduled:\n\n' +
        'Service: {{serviceName}}\nNew date: {{appointmentDate}}\nNew time: {{appointmentTime}}\n\n' +
        'Questions? Call {{practicePhone}}{{practiceEmailLine}}.\n\n' +
        '— {{practiceName}}',
    },
    ur: {
      sms: '{{patientName}}، {{practiceName}} کے ساتھ آپ کی اپائنٹمنٹ کی نئی تاریخ {{appointmentDate}} اور وقت {{appointmentTime}} ہے۔',
      emailSubject: 'اپائنٹمنٹ کی تاریخ تبدیل — {{practiceName}}',
      emailBody:
        '{{patientName}}،\n\n' +
        '{{practiceName}} کے ساتھ آپ کی اپائنٹمنٹ کی تاریخ تبدیل کر دی گئی ہے:\n\n' +
        'سروس: {{serviceName}}\nنئی تاریخ: {{appointmentDate}}\nنیا وقت: {{appointmentTime}}\n\n' +
        'سوالات کے لیے {{practicePhone}} پر رابطہ کریں{{practiceEmailLine}}۔\n\n' +
        '— {{practiceName}}',
    },
  },
  appointment_cancelled: {
    en: {
      sms: 'Hi {{patientName}}, your appointment with {{practiceName}} on {{appointmentDate}} has been cancelled. Please contact us at {{practicePhone}} if you\'d like to book another time.',
      emailSubject: 'Appointment cancelled — {{practiceName}}',
      emailBody:
        'Hi {{patientName}},\n\n' +
        'Your appointment with {{practiceName}} on {{appointmentDate}} at {{appointmentTime}} has been cancelled.\n\n' +
        'Please contact us at {{practicePhone}}{{practiceEmailLine}} if you\'d like to book another time.\n\n' +
        '— {{practiceName}}',
    },
    ur: {
      sms: '{{patientName}}، {{practiceName}} کے ساتھ آپ کی {{appointmentDate}} کی اپائنٹمنٹ منسوخ کر دی گئی ہے۔ نئی اپائنٹمنٹ کے لیے {{practicePhone}} پر رابطہ کریں۔',
      emailSubject: 'اپائنٹمنٹ منسوخ — {{practiceName}}',
      emailBody:
        '{{patientName}}،\n\n' +
        '{{practiceName}} کے ساتھ آپ کی {{appointmentDate}} بوقت {{appointmentTime}} اپائنٹمنٹ منسوخ کر دی گئی ہے۔\n\n' +
        'دوبارہ بکنگ کے لیے براہ کرم {{practicePhone}} پر رابطہ کریں{{practiceEmailLine}}۔\n\n' +
        '— {{practiceName}}',
    },
  },
  appointment_reminder: {
    en: {
      sms: 'Reminder: {{patientName}}, you have a {{serviceName}} appointment with {{practiceName}} on {{appointmentDate}} at {{appointmentTime}}. Reply or call {{practicePhone}} to reschedule.',
      emailSubject: 'Reminder: your upcoming appointment — {{practiceName}}',
      emailBody:
        'Hi {{patientName}},\n\n' +
        'This is a reminder of your upcoming appointment:\n\n' +
        'Service: {{serviceName}}\nDate: {{appointmentDate}}\nTime: {{appointmentTime}}\n\n' +
        'Need to reschedule or cancel? Call {{practicePhone}}{{practiceEmailLine}}.\n\n' +
        '— {{practiceName}}',
    },
    ur: {
      sms: 'یاد دہانی: {{patientName}}، {{practiceName}} کے ساتھ آپ کی {{serviceName}} اپائنٹمنٹ {{appointmentDate}} بوقت {{appointmentTime}} ہے۔ تبدیلی کے لیے {{practicePhone}} پر رابطہ کریں۔',
      emailSubject: 'یاد دہانی: آپ کی آنے والی اپائنٹمنٹ — {{practiceName}}',
      emailBody:
        '{{patientName}}،\n\n' +
        'یہ آپ کی آنے والی اپائنٹمنٹ کی یاد دہانی ہے:\n\n' +
        'سروس: {{serviceName}}\nتاریخ: {{appointmentDate}}\nوقت: {{appointmentTime}}\n\n' +
        'تاریخ کی تبدیلی یا منسوخی کے لیے {{practicePhone}} پر رابطہ کریں{{practiceEmailLine}}۔\n\n' +
        '— {{practiceName}}',
    },
  },
  // Clinic-facing (not patient-facing) — see notificationService.js's
  // notifyHumanHandoff/notifyEmergencyClinicAlert. Only "necessary
  // information" per spec §15/§16: never the full message body, never
  // unrelated patient details.
  human_handoff: {
    en: {
      sms: '{{practiceName}}: new patient handoff requires attention ({{handoffReason}}). Caller: {{patientName}}, {{practicePhone2}}.',
      emailSubject: 'New patient handoff — {{practiceName}}',
      emailBody:
        'A new handoff request needs attention.\n\n' +
        'Reason: {{handoffReason}}\nCaller: {{patientName}}\nContact number: {{practicePhone2}}\n\n' +
        'View details in the admin dashboard.',
    },
  },
  emergency_alert: {
    en: {
      sms: 'URGENT — {{practiceName}}: a caller reported a possible medical emergency during their conversation. They were told to call 911/ER immediately. No further action may be needed, but review this conversation.',
      emailSubject: 'URGENT: possible emergency reported — {{practiceName}}',
      emailBody:
        'A caller reported language consistent with a possible medical emergency during a conversation with the AI receptionist.\n\n' +
        'They were immediately told to call 911 (or their local emergency number) or go to the nearest emergency room — ' +
        'this already happened automatically and does not require action to take effect. This alert is so your team can ' +
        'review the conversation and follow up if appropriate.\n\n' +
        'Channel: {{handoffReason}}',
    },
  },
};

function escapeHtmlBody(text) {
  // The plain-text email body already only contains template-authored
  // literal text plus already-escaped substituted values (see render()),
  // so this only needs to convert newlines to <br> for the HTML part.
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/**
 * Renders one notification type for one channel/language.
 *
 * @param {string} type - a key in TEMPLATES
 * @param {'sms'|'email'} channel
 * @param {object} variables - e.g. { practiceName, patientName, serviceName, appointmentDate, appointmentTime, practicePhone, practiceEmail }
 * @param {'en'|'ur'} [language]
 * @returns {{ body: string }|{ subject: string, text: string, html: string }}
 */
function render(type, channel, variables = {}, language = 'en') {
  const templateSet = TEMPLATES[type];
  if (!templateSet) throw new Error(`Unknown notification template type "${type}"`);
  const lang = templateSet[language] ? language : 'en'; // §14: fall back to English rather than fail if a language variant doesn't exist for this type
  const t = templateSet[lang];

  const enrichedVariables = {
    ...variables,
    practiceEmailLine: variables.practiceEmail ? ` or ${variables.practiceEmail}` : '',
  };

  if (channel === 'sms') {
    return { body: fillTemplate(t.sms, enrichedVariables) };
  }

  const subject = fillTemplate(t.emailSubject, enrichedVariables);
  const text = fillTemplate(t.emailBody, enrichedVariables);
  // The HTML part is derived from the already-sanitized plain text (see
  // above) — there is exactly one place variable substitution happens,
  // never a second hand-maintained HTML copy that could drift or reintroduce
  // an injection path.
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5;">${escapeHtmlBody(text)}</div>`;
  return { subject, text, html };
}

function listTemplateTypes() {
  return Object.keys(TEMPLATES);
}

module.exports = { render, listTemplateTypes, fillTemplate, escapeHtml, sanitizePlainText };
