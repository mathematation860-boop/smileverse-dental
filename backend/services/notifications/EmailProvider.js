/**
 * Email provider interface (Phase 5 spec §2).
 *
 * Every implementation — mock or real — returns the SAME structured result
 * shape, so notificationService.js (the only caller) never has to know or
 * care which vendor is behind it:
 *
 *   {
 *     success: boolean,          // true ONLY if the provider itself
 *                                // confirmed acceptance — never optimistic
 *     simulated: boolean,        // true for the mock provider — lets a
 *                                // caller/UI distinguish "simulated" from
 *                                // a genuine (if failed) real attempt
 *     providerMessageId: string|null,  // the real vendor's own message id,
 *                                       // when it gave one — never invented
 *     providerStatus: string|null,     // the vendor's own status string
 *                                       // (e.g. 'queued', 'rejected') — never invented
 *     failureReason: string|null,      // set whenever success is false
 *   }
 *
 * Spec §4/§30: nothing may ever report success:true unless the underlying
 * provider actually accepted the message. A provider throwing is also
 * acceptable — notificationService.js catches it and records a failure —
 * but every implementation SHOULD prefer returning a `success:false`
 * result over throwing, so a full provider outage doesn't look different
 * from a normal rejection in the notification history.
 */
class EmailProvider {
  // eslint-disable-next-line no-unused-vars
  async send({ to, subject, text, html }) {
    throw new Error('EmailProvider.send() not implemented');
  }

  /** Whether this provider instance has everything it needs (real credentials) to genuinely attempt a send. The mock provider is always "configured" (it never needs credentials); a real provider must check its actual env vars, never assume. */
  isConfigured() {
    return true;
  }
}

module.exports = EmailProvider;
