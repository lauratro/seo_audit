/**
 * Outcome of one check. Only `warn` and `fail` describe a potential SEO
 * issue; `info`, `not_checked` and `not_applicable` never count as failures.
 */
export const CHECK_STATUSES = [
  // The check passed.
  'pass',
  // A potential issue that needs attention (it may be intentional).
  'warn',
  // The check detected a problem.
  'fail',
  // A neutral observation, not an issue (e.g. no JSON-LD on the page).
  'info',
  // The check could not be performed or was not executed.
  'not_checked',
  // The check does not apply to this page (e.g. description length when
  // there is no description).
  'not_applicable',
] as const;

export type CheckStatus = (typeof CHECK_STATUSES)[number];
