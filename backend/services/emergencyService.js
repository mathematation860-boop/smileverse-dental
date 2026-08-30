/**
 * Deterministic, keyword-based emergency/urgency triage.
 *
 * This runs BEFORE any AI call, on every incoming chat message, as a
 * safety net: life-threatening language should never depend on an LLM
 * correctly classifying it. The AI is still used afterward for the
 * conversational reply, but the safety-critical decision (advise 911 /
 * ER right now) is made here, deterministically.
 *
 * This module never diagnoses anything — it only pattern-matches
 * keywords the patient used and returns a severity bucket + a safe,
 * pre-written message. It intentionally does not call any AI model.
 */

// Symptoms that could indicate a medical emergency, not just a dental one.
// These should always be told to seek immediate in-person/emergency care.
const LIFE_THREATENING_PATTERNS = [
  /can'?t breathe/i,
  /difficult(y)? breathing/i,
  /trouble breathing/i,
  /can'?t swallow/i,
  /difficult(y)? swallowing/i,
  /trouble swallowing/i,
  /throat.*(closing|swelling shut)/i,
  /chest pain/i,
  /uncontrollable bleeding/i,
  /won'?t stop bleeding/i,
  /bleeding.*(a lot|heavily|won'?t stop)/i,
  /passed out/i,
  /unconscious/i,
  /severe allergic reaction/i,
  /face.*swoll.*(spreading|eye|neck)/i,
  /swelling.*(eye|neck|throat)/i,
];

// Urgent dental issues: not life-threatening, but should be offered a
// same-day / earliest-available slot rather than routine scheduling.
const URGENT_PATTERNS = [
  /severe (tooth\s?)?pain/i,
  /excruciating/i,
  /unbearable pain/i,
  /tooth(\s|-)?ache/i,
  /toothache/i,
  /knocked out/i,
  /broke(n)? (my |a )?tooth/i,
  /cracked (my |a )?tooth/i,
  /chipped (my |a )?tooth/i,
  /swoll(en|ing)/i,
  /abscess/i,
  /infection/i,
  /bleeding gums?/i,
  /lost (a |my )?filling/i,
  /lost (a |my )?crown/i,
  /dental emergency/i,
  /emergency appointment/i,
  /urgent/i,
];

function classifyUrgency(message) {
  const text = (message || '').toLowerCase();

  if (LIFE_THREATENING_PATTERNS.some((re) => re.test(text))) {
    return 'life_threatening';
  }
  if (URGENT_PATTERNS.some((re) => re.test(text))) {
    return 'urgent';
  }
  return 'none';
}

const LIFE_THREATENING_MESSAGE_EN =
  "This sounds like it could be a medical emergency, not something I can help with over chat. " +
  "Please call 911 (or your local emergency number) or go to the nearest emergency room right away. " +
  "Once you're safe, we're here to help with any follow-up dental care you need.";

const LIFE_THREATENING_MESSAGE_UR =
  'یہ ایک طبی ہنگامی صورتحال ہو سکتی ہے جس میں چیٹ کے ذریعے مدد ممکن نہیں۔ ' +
  'براہ کرم فوری طور پر 911 (یا اپنے علاقے کا ایمرجنسی نمبر) پر کال کریں یا قریب ترین ایمرجنسی روم جائیں۔ ' +
  'محفوظ ہونے کے بعد، دانتوں کے کسی بھی فالو اپ علاج کے لیے ہم حاضر ہیں۔';

// Fallback for an "urgent" (not life-threatening) dental issue — e.g. severe
// pain, a knocked-out tooth, facial swelling without airway involvement —
// used ONLY when the AI call itself fails (rate limit, outage, bad
// credentials) so a patient with a genuinely urgent issue never gets the
// same bland "please try again" reply a random chit-chat failure would get.
// Found during a QA audit: before this existed, an AI outage on an urgent
// (but not life-threatening) message silently dropped back to the generic
// error with no safety-aware guidance at all.
const URGENT_FALLBACK_MESSAGE_EN =
  "This sounds like it may need prompt attention, and I'm having trouble reaching our scheduling system right now. " +
  'Please call our office directly so our team can help you as soon as possible.';

const URGENT_FALLBACK_MESSAGE_UR =
  'ایسا لگتا ہے کہ اس پر جلد توجہ کی ضرورت ہے، اور ابھی میں شیڈولنگ سسٹم تک رسائی حاصل کرنے میں مشکل محسوس کر رہا ہوں۔ ' +
  'براہ کرم براہ راست ہمارے دفتر کو کال کریں تاکہ ہماری ٹیم جلد از جلد آپ کی مدد کر سکے۔';

const SEVERITY_RANK = { none: 0, moderate: 1, urgent: 2, severe: 2, life_threatening: 3 };

/** Returns whichever of the two urgency labels is more severe. */
function combineUrgency(a, b) {
  const rankA = SEVERITY_RANK[a] ?? 0;
  const rankB = SEVERITY_RANK[b] ?? 0;
  return rankA >= rankB ? (a || 'none') : (b || 'none');
}

module.exports = {
  classifyUrgency,
  combineUrgency,
  LIFE_THREATENING_MESSAGE_EN,
  LIFE_THREATENING_MESSAGE_UR,
  URGENT_FALLBACK_MESSAGE_EN,
  URGENT_FALLBACK_MESSAGE_UR,
};
