/** Checks on the page's content as delivered in the initial HTML. */
export const CONTENT_CHECK_IDS = [
  // Heuristic: share of visible text in the initial HTML response, to spot
  // pages that depend on JavaScript. Not proof of what a browser renders.
  'initial_render',
] as const;

export type ContentCheckId = (typeof CONTENT_CHECK_IDS)[number];
