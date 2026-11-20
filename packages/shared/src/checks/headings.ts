/** Checks on the page's heading elements (`<h1>`–`<h6>`). */
export const HEADING_CHECK_IDS = [
  // At least one <h1> with text.
  'h1_presence',
  // More than one <h1> (an observation, not automatically an error).
  'h1_multiple',
  // Skipped heading levels, e.g. <h2> followed by <h4>.
  'heading_order',
] as const;

export type HeadingCheckId = (typeof HEADING_CHECK_IDS)[number];
