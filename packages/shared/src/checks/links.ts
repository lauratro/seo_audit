/** Checks on the links found on the page. */
export const LINK_CHECK_IDS = [
  // Linked URLs that are confirmed unavailable (e.g. 404, 410). Responses that
  // allow no reliable conclusion (403, 429, 5xx, timeouts) are kept apart.
  'broken_links',
] as const;

export type LinkCheckId = (typeof LINK_CHECK_IDS)[number];
