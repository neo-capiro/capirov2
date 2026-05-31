/**
 * Single source of truth for the FEC contribution-flow legal/compliance disclaimer.
 *
 * The FEC panels surface employer-linked individual contributions resolved to
 * candidates/members — compliance-sensitive content. This text is returned by the
 * API (getFecMoneyFlow + the profile-v1 aggregate) so every frontend renders the
 * exact same, legally-reviewed wording and the copies cannot drift.
 *
 * Three required points (per legal review):
 *  1. Source + nature: public FEC filings, shown for intelligence purposes only,
 *     not legal/compliance/campaign-finance advice.
 *  2. Individual != organizational: a contribution attributed via a contributor's
 *     listed employer is that individual's, legally distinct from a corporate/PAC one.
 *  3. Not a recommendation: nothing here suggests making, soliciting, or directing
 *     any political contribution.
 */
export const FEC_DISCLAIMER =
  'Source: public Federal Election Commission filings, shown for informational and intelligence ' +
  'purposes only — not legal, compliance, or campaign-finance advice. Contributions attributed via a ' +
  "contributor's listed employer reflect individual filers and are legally distinct from any " +
  'contribution by that organization or its PAC. Nothing here is a recommendation to make, solicit, ' +
  'or direct any political contribution. Verify against the official record at FEC.gov before relying on it.';
