/**
 * Price guard — checks a model-written reply against the practice's real
 * price list before a patient ever sees it.
 *
 * WHAT WAS WRONG (audit, Sept 2026). The original check built one Set of
 * every configured price and asked only "is this number in the set?".
 * That let three real errors through:
 *
 *   1. The right number attached to the WRONG SERVICE. "A root canal is
 *      $150" passed, because $150 is the cleaning price. A quoted price
 *      is a promise about a specific treatment; checking the number in
 *      isolation checks nothing a patient cares about.
 *   2. Cents were discarded ('150.99'.split('.')[0] === '150'), so
 *      "$150.99" was accepted as if it were $150.
 *   3. Only '$' was recognised. "150 PKR", "€150" or "150 euros" were not
 *      amounts as far as the guard was concerned, so they were never
 *      checked at all — and this clinic bills in one currency.
 *
 * Separately, "$1,200" matched only the leading "$1" and was flagged as a
 * fabricated price — a false positive on a correctly written figure.
 *
 * WHAT THIS DOES. Sentence by sentence: find every monetary amount
 * (whatever currency it is written in), and decide whether it is
 * defensible.
 *   - An amount in any currency other than the practice's is rejected
 *     outright. There is no exchange rate in this system and inventing
 *     one is exactly the kind of confident wrongness the guard exists to
 *     stop.
 *   - If the sentence names exactly one service, the amount must be that
 *     service's configured price. A service with no configured price
 *     ("priced after evaluation") justifies no amount at all.
 *   - Otherwise — no service named, or several — the amount must at least
 *     match some configured price, which is the original check kept as a
 *     floor.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. This is string matching, not language
 * understanding. It cannot catch a wrong price described without naming
 * the service ("that one is $150"), and it can misfire on an unusual
 * sentence. Both failures are one-directional by design: a false positive
 * replaces the reply with "please check the Prices section", which costs
 * helpfulness; a false negative would cost the patient money. The
 * remaining gap is recorded in the audit findings rather than implied
 * away.
 */

/** Currency symbols and codes that are never this practice's own. */
const FOREIGN_SYMBOLS = ['€', '£', '¥', '₹', '₨', '₩', '₦', '₪', '฿', 'C$', 'A$'];
const FOREIGN_CODES = ['EUR', 'GBP', 'PKR', 'INR', 'AED', 'CAD', 'AUD', 'JPY', 'CNY', 'SAR', 'NGN', 'ZAR', 'CHF'];
const FOREIGN_WORDS = ['euro', 'euros', 'pound', 'pounds', 'rupee', 'rupees', 'dirham', 'dirhams', 'yen', 'yuan', 'riyal', 'riyals'];

/** Written forms that DO mean this practice's currency (USD). */
const LOCAL_CODES = ['USD'];
const LOCAL_WORDS = ['dollar', 'dollars', 'buck', 'bucks'];

function toNumber(digits) {
  return Number(String(digits).replace(/,/g, ''));
}

/** Splits on sentence boundaries and newlines; a service and its price normally share a sentence. */
function splitSentences(text) {
  return String(text)
    .split(/(?<=[.!?،۔])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Every monetary amount in one sentence, with the currency it was written
 * in. Handles thousands separators and both orders ("$1,200" and
 * "1200 USD"), because a real reply uses both.
 */
function findAmounts(sentence) {
  const amounts = [];

  const foreignSymbolPattern = new RegExp(
    `(${FOREIGN_SYMBOLS.map((s) => s.replace(/\$/g, '\\$')).join('|')})\\s?(\\d[\\d,]*(?:\\.\\d{1,2})?)`,
    'g'
  );
  let m;
  while ((m = foreignSymbolPattern.exec(sentence))) {
    amounts.push({ raw: m[0], value: toNumber(m[2]), foreign: true });
  }

  // '$' last among symbols so 'C$'/'A$' above claim their matches first.
  const localSymbolPattern = /(?<![A-Za-z\d])\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
  while ((m = localSymbolPattern.exec(sentence))) {
    const alreadyForeign = amounts.some((a) => a.foreign && sentence.indexOf(a.raw) <= m.index && m.index < sentence.indexOf(a.raw) + a.raw.length);
    if (!alreadyForeign) amounts.push({ raw: m[0], value: toNumber(m[1]), foreign: false });
  }

  const suffixPattern = new RegExp(
    `(\\d[\\d,]*(?:\\.\\d{1,2})?)\\s?(${[...FOREIGN_CODES, ...LOCAL_CODES].join('|')}|${[...FOREIGN_WORDS, ...LOCAL_WORDS].join('|')})\\b`,
    'gi'
  );
  while ((m = suffixPattern.exec(sentence))) {
    const unit = m[2].toUpperCase();
    const foreign =
      FOREIGN_CODES.includes(unit) || FOREIGN_WORDS.includes(m[2].toLowerCase());
    amounts.push({ raw: m[0], value: toNumber(m[1]), foreign });
  }

  return amounts;
}

/** Configured services whose name is mentioned in this sentence. */
function servicesMentioned(sentence, services) {
  const haystack = sentence.toLowerCase();
  return services.filter((service) => {
    const name = String(service.name || '').toLowerCase().trim();
    if (name && haystack.includes(name)) return true;
    // 'root_canal' / 'root-canal' also reads as 'root canal' in prose.
    const fromId = String(service.id || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
    return !!fromId && haystack.includes(fromId);
  });
}

/**
 * The first indefensible amount in `replyText`, or null.
 * Returns { raw, value, reason, service, expected } — `reason` is one of
 * 'foreign_currency', 'wrong_service_price', 'service_has_no_price',
 * 'unknown_amount'.
 */
function inspectPrices(replyText, practice) {
  if (!replyText) return null;
  const services = (practice?.services || []).filter(Boolean);
  const configuredPrices = new Set(
    services.filter((s) => s.price !== null && s.price !== undefined).map((s) => Number(s.price))
  );

  for (const sentence of splitSentences(replyText)) {
    const amounts = findAmounts(sentence);
    if (!amounts.length) continue;

    const named = servicesMentioned(sentence, services);

    for (const amount of amounts) {
      if (amount.foreign) {
        return { raw: amount.raw, value: amount.value, reason: 'foreign_currency', service: null, expected: null };
      }

      if (named.length === 1) {
        const service = named[0];
        if (service.price === null || service.price === undefined) {
          return { raw: amount.raw, value: amount.value, reason: 'service_has_no_price', service: service.name, expected: null };
        }
        if (Number(service.price) !== amount.value) {
          return {
            raw: amount.raw,
            value: amount.value,
            reason: 'wrong_service_price',
            service: service.name,
            expected: Number(service.price),
          };
        }
        continue;
      }

      // No service named, or several — fall back to the original check.
      if (!configuredPrices.has(amount.value)) {
        return { raw: amount.raw, value: amount.value, reason: 'unknown_amount', service: null, expected: null };
      }
    }
  }

  return null;
}

/**
 * Backwards-compatible shape: the offending text, or null. Kept because
 * the provider and its existing tests treat the result as a string.
 */
function findPriceMismatch(replyText, practice) {
  const found = inspectPrices(replyText, practice);
  return found ? found.raw : null;
}

module.exports = { findPriceMismatch, inspectPrices, findAmounts, servicesMentioned, splitSentences };
