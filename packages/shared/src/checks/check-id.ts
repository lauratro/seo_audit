import { CONTENT_CHECK_IDS, type ContentCheckId } from './content.js';
import { HEADING_CHECK_IDS, type HeadingCheckId } from './headings.js';
import { IMAGE_CHECK_IDS, type ImageCheckId } from './images.js';
import { LINK_CHECK_IDS, type LinkCheckId } from './links.js';
import { METADATA_CHECK_IDS, type MetadataCheckId } from './metadata.js';
import { TITLE_CHECK_IDS, type TitleCheckId } from './title.js';

/**
 * Identifier of one granular SEO check. IDs are stable: add new ones,
 * never rename or remove one that is in use.
 */
export type CheckId =
  | TitleCheckId
  | HeadingCheckId
  | ImageCheckId
  | MetadataCheckId
  | LinkCheckId
  | ContentCheckId;

/** Every CheckId, e.g. for building a Zod enum at runtime. */
export const CHECK_IDS: readonly CheckId[] = [
  ...TITLE_CHECK_IDS,
  ...HEADING_CHECK_IDS,
  ...IMAGE_CHECK_IDS,
  ...METADATA_CHECK_IDS,
  ...LINK_CHECK_IDS,
  ...CONTENT_CHECK_IDS,
];
