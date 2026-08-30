/**
 * Pure TwiML XML builders — shared by MockTelephonyProvider and
 * TwilioTelephonyProvider, since the only real difference between "real
 * Twilio" and "safe mock mode" for THIS app is credential/signature
 * handling, not the shape of the voice response. Keeping the XML-building
 * logic in one place (rather than duplicated per provider) means a mock
 * call and a real call produce byte-for-byte identical TwiML for the same
 * inputs — exactly what "a genuine implementation, not a fake chatbot"
 * requires: pointing a real Twilio number at this server in mock mode
 * would still work correctly, it would just be running in demoMode.
 *
 * No XML templating library — TwiML's element set used here is tiny
 * (Response/Say/Gather/Dial/Hangup/Redirect), so a small, fully-tested
 * escape function is safer and lighter than adding a dependency for it.
 */

/** Escapes text for safe inclusion inside TwiML XML content/attributes. Never trust practice config or AI-generated text to already be XML-safe. */
function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const LANGUAGE_MAP = { en: 'en-US', ur: 'ur-PK' };

/** Normalizes a practice/entity language code ('en'/'ur') to the BCP-47 tag Twilio's <Say>/<Gather> `language` attribute expects. Defaults to en-US for anything unrecognized rather than failing the call. */
function toTwilioLanguage(language) {
  if (language === 'en-US' || language === 'ur-PK') return language;
  return LANGUAGE_MAP[language] || 'en-US';
}

function sayTag(text, language) {
  return `<Say voice="Polly.Joanna" language="${escapeXml(toTwilioLanguage(language))}">${escapeXml(text)}</Say>`;
}

/** "Say this, then listen for speech and POST it to actionUrl." speechTimeout="auto" lets Twilio detect the caller has stopped talking rather than using a fixed silence window — closer to natural conversation pacing (Phase 4 spec §15). */
function buildSayAndGather({ text, actionUrl, language }) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Response>' +
    `<Gather input="speech" action="${escapeXml(actionUrl)}" method="POST" speechTimeout="auto" language="${escapeXml(toTwilioLanguage(language))}">` +
    sayTag(text, language) +
    '</Gather>' +
    // If the caller says nothing at all, Gather falls through to here —
    // repeat the prompt once via Redirect rather than silently hanging up.
    `<Redirect method="POST">${escapeXml(actionUrl)}</Redirect>` +
    '</Response>'
  );
}

/** "Say this, then end the call." Used for emergencies, goodbyes, and unrecoverable failures — never leaves the caller listening to silence. */
function buildSayAndHangup({ text, language }) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Response>' +
    sayTag(text, language) +
    '<Hangup/>' +
    '</Response>'
  );
}

/** "Say a short transition line, then transfer." Falls back to a safe callback message if no transferTo number is configured — never attempts <Dial> with nothing to dial. */
function buildTransfer({ text, transferTo, language }) {
  if (!transferTo) {
    return buildSayAndHangup({
      text: `${text} I'm not able to transfer you automatically right now — please call our office directly and our team will help you.`,
      language,
    });
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Response>' +
    sayTag(text, language) +
    `<Dial>${escapeXml(transferTo)}</Dial>` +
    '</Response>'
  );
}

/**
 * Phase 5: a TwiML Messaging Response — the reply Twilio expects from an
 * inbound-SMS webhook (routes/smsWebhook.js). Lives here rather than a
 * separate file because it shares the exact same `escapeXml` this file
 * already tests and uses for voice TwiML — one escape implementation for
 * every kind of TwiML this app produces.
 */
function buildMessagingResponse({ text }) {
  if (!text) {
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(text)}</Message></Response>`;
}

module.exports = { escapeXml, toTwilioLanguage, buildSayAndGather, buildSayAndHangup, buildTransfer, buildMessagingResponse };
