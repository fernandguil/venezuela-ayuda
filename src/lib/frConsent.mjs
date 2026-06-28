// Pure gate logic for FR biometric indexing consent. No side effects.
// Exported for use by src/app/actions.ts and scripts/fr-consent.test.mjs.

// Status that means the submitter is uploading a photo of *someone else* —
// third-party photos must never be indexed without that person's own consent.
export const THIRD_PARTY_PHOTO_STATUSES = /** @type {readonly string[]} */ (["LOOKING_FOR_SOMEONE"]);

/**
 * Returns true only when both conditions are satisfied:
 * 1. The user explicitly ticked the consent checkbox (value "1").
 * 2. The status is not one where the photo belongs to a third party.
 *
 * @param {string | null} frConsentValue - form field value ("1" = checked)
 * @param {string} status - checkin status
 * @returns {boolean}
 */
export function shouldIndexForFR(frConsentValue, status) {
  return frConsentValue === "1" && !THIRD_PARTY_PHOTO_STATUSES.includes(status);
}
