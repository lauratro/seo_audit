/** Checks on page metadata: description, canonical, robots, structured data. */
export const METADATA_CHECK_IDS = [
  // A meta description exists and contains text.
  'meta_description_presence',
  // Character length of the meta description against documented thresholds.
  'meta_description_length',
  // A <link rel="canonical"> exists.
  'canonical_presence',
  // Exactly one canonical, with an absolute, parseable http(s) URL.
  // Pointing to another page can be intentional.
  'canonical_validity',
  // Robots meta tag and X-Robots-Tag header (noindex/nofollow can be intentional).
  'robots_directives',
  // At least one JSON-LD block (absence is informational, not an issue).
  'structured_data_presence',
  // Each JSON-LD block parses as JSON (syntax only, not schema.org rules).
  'structured_data_syntax',
] as const;

export type MetadataCheckId = (typeof METADATA_CHECK_IDS)[number];
