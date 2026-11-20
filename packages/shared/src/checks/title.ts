/** Checks on the page's `<title>` element. */
export const TITLE_CHECK_IDS = [
  // A <title> exists and contains non-whitespace text.
  'title_presence',
  // Character length of the title against documented thresholds.
  'title_length',
  // Estimated display width in search results (approximation, no browser).
  'title_pixel_width',
] as const;

export type TitleCheckId = (typeof TITLE_CHECK_IDS)[number];
