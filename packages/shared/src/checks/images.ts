/** Checks on the page's `<img>` elements. */
export const IMAGE_CHECK_IDS = [
  // <img> elements without an alt attribute. An empty alt="" is valid for
  // decorative images and is not reported as missing.
  'img_alt_presence',
] as const;

export type ImageCheckId = (typeof IMAGE_CHECK_IDS)[number];
