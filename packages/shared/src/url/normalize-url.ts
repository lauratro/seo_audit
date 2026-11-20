// Matches an explicit scheme such as "https://" at the start of the input.
const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:\/\//i;

/**
 * Normalises a user-supplied page URL so the same page always produces the
 * same string (used, for example, as the audit cache key).
 *
 * Rules: trim whitespace; add "https://" when no scheme is given; accept only
 * http and https; lowercase scheme and host and drop default ports (done by
 * the URL API); drop the fragment and an empty "?"; keep path, query and
 * parameter order exactly as given.
 *
 * Returns null when the input is not a parseable http(s) URL.
 *
 * This is NOT a security check: localhost, private IPs or credentials pass
 * through unchanged. SafeFetcher's URL and IP policies reject them.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  const withScheme = SCHEME_PATTERN.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  url.hash = '';
  // An empty query ("/page?") reads back as "", but href still ends in "?".
  // Assigning "" removes the "?".
  if (url.search === '') {
    url.search = '';
  }

  return url.href;
}
//TODO: send error to frontend to communicate that the URL is invalid. This is a temporary solution until we have a better error handling mechanism in place.
