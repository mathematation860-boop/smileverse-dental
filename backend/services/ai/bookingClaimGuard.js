/**
 * Stops the assistant from announcing a booking it did not make.
 *
 * WHAT WAS ONLY A PROMISE. The architecture is sound: the model never
 * executes anything, and every side effect goes through the deterministic
 * REST layer into tools/receptionistTools.js. config/promptBuilder.js also
 * instructs the model never to say a booking succeeded unless told the
 * system confirmed it. But that instruction was the ONLY thing standing
 * between a patient and the sentence "you're all booked for Tuesday at
 * 10" — and a prompt instruction is a request, not a control. A model that
 * ignores it produces a patient who does not turn up, or who turns up to a
 * slot the clinic never held.
 *
 * The price guard already exists for exactly this class of problem
 * (services/ai/priceGuard.js): the model may talk about prices, but a
 * figure it invents never reaches the patient. This is the same idea
 * applied to the other statement the model must never make on its own.
 *
 * THE RULE. The chat model never confirms a booking, in any conversation,
 * ever — because in this architecture it never can. So the reply is
 * checked for a claim that a booking has ALREADY happened, and any such
 * reply is replaced. Offers and future tense are untouched: "I can book
 * that for you" and "would you like me to hold 10am?" are exactly what the
 * assistant should say, since the booking form is what actually reserves
 * the slot.
 *
 * DELIBERATE BIAS. Matching is on affirmative completed-booking phrasings,
 * learned from the price guard's own bug history: an earlier version of
 * that guard banned the bare word "hipaa" and so blocked honest denials
 * along with false claims. The patterns here are therefore specific
 * phrases, not keywords. Where the guard does misfire — a negated form
 * such as "I can't say your appointment is confirmed" will trip it — it
 * fails toward saying less, which costs a little helpfulness and no
 * accuracy.
 *
 * COVERAGE, STATED HONESTLY. English is covered thoroughly; Urdu covers
 * the common affirmative forms only. A model could still invent a
 * construction neither list anticipates. This narrows a prompt-only
 * promise into a mostly-enforced one; it does not make it airtight, and
 * the deterministic layer remains the thing that actually books.
 */

const BOOKING_CLAIM_FALLBACK_EN =
  "I can't book an appointment myself — I'd hate to tell you a time is held when it isn't. Use the booking form and you'll get a confirmation with a reference number once the slot is really reserved.";

const BOOKING_CLAIM_FALLBACK_UR =
  'میں خود اپائنٹمنٹ بک نہیں کر سکتا — میں آپ کو غلطی سے یہ نہیں بتانا چاہتا کہ وقت محفوظ ہو گیا ہے۔ براہ کرم بکنگ فارم استعمال کریں، سلاٹ واقعی محفوظ ہونے پر آپ کو ریفرنس نمبر کے ساتھ تصدیق مل جائے گی۔';

/**
 * Claims that a booking has already been made. Present/past completed
 * forms only — nothing here matches an offer or a question.
 */
const COMPLETED_BOOKING_CLAIMS = [
  // "I've booked you in", "I have scheduled", "I've reserved"
  /\bi(?:'ve|\s+have)\s+(?:now\s+|already\s+|gone\s+ahead\s+and\s+)?(?:booked|scheduled|reserved|confirmed|secured)\b/i,
  // "you're booked", "you are all set", "you're confirmed"
  /\byou(?:'re|\s+are)\s+(?:now\s+|all\s+)?(?:booked|scheduled|confirmed|set)\b/i,
  // "your appointment is booked / has been confirmed"
  /\byour\s+(?:appointment|booking|visit|slot)\s+(?:is|has\s+been|'s)\s+(?:now\s+)?(?:booked|scheduled|confirmed|reserved|set|secured)\b/i,
  // "the appointment is confirmed", "booking confirmed"
  /\b(?:appointment|booking)\s+(?:is\s+)?confirmed\b/i,
  // "I've put you down for", "I've added you in"
  /\bi(?:'ve|\s+have)\s+(?:put|added|slotted|pencilled|penciled)\s+you\b/i,
  // "that's booked", "that is now reserved"
  /\bthat(?:'s|\s+is)\s+(?:now\s+)?(?:booked|reserved|confirmed)\b/i,
  // "we'll see you on Tuesday" implies a held slot
  /\b(?:see\s+you|we'll\s+see\s+you)\s+(?:on|at|this|next|tomorrow)\b/i,
  // "you have an appointment on ..." stated as fact about a new booking
  /\byou\s+(?:now\s+)?have\s+an\s+appointment\s+(?:on|at|for)\b/i,
];

/** Common Urdu affirmative forms. Partial coverage by design — see header. */
const COMPLETED_BOOKING_CLAIMS_UR = [
  /بک\s*ہو\s*(?:گئی|گیا|چکی|چکا)/,
  /اپائنٹمنٹ\s*(?:کنفرم|طے|محفوظ)\s*(?:ہو\s*(?:گئی|گیا))?/,
  /میں\s*نے\s*(?:آپ\s*کی\s*)?(?:اپائنٹمنٹ|بکنگ)\s*(?:کر\s*دی|بک\s*کر\s*دی)/,
];

/**
 * The offending phrase, or null. Returned rather than a boolean so the
 * caller can log what the model actually said.
 */
function findBookingClaim(replyText) {
  if (!replyText || typeof replyText !== 'string') return null;
  for (const pattern of [...COMPLETED_BOOKING_CLAIMS, ...COMPLETED_BOOKING_CLAIMS_UR]) {
    const match = pattern.exec(replyText);
    if (match) return match[0];
  }
  return null;
}

/** The replacement text for a reply that claimed a booking. */
function bookingClaimFallback(language) {
  return language === 'ur' ? BOOKING_CLAIM_FALLBACK_UR : BOOKING_CLAIM_FALLBACK_EN;
}

module.exports = {
  findBookingClaim,
  bookingClaimFallback,
  BOOKING_CLAIM_FALLBACK_EN,
  BOOKING_CLAIM_FALLBACK_UR,
};
