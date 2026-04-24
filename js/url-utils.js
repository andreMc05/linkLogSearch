import normalizeUrl from './vendor/normalize-url.js';

/**
 * @typedef {{ type: 'empty' }} EmptyParse
 * @typedef {{ type: 'text', content: string }} TextParse
 * @typedef {{ type: 'url', url: string, domain: string, path: string, originalLine: string }} UrlParse
 */

/**
 * normalize-url options applied to every stored URL:
 * - forceHttps: upgrades http → https
 * - stripWWW: www.example.com → example.com (better dedup)
 * - removeQueryParameters: strips utm_* tracking params
 * - sortQueryParameters: canonical param order for dedup
 * - removeTrailingSlash: example.com/foo/ → example.com/foo
 * - stripTextFragment: strips #:~:text=… anchors
 * - stripAuthentication: removes user:pass@ credentials
 */
const NORMALIZE_OPTS = {
  forceHttps: true,
  stripWWW: true,
  removeQueryParameters: [/^utm_\w+/i],
  sortQueryParameters: true,
  removeTrailingSlash: true,
  stripTextFragment: true,
  stripAuthentication: true,
};

/**
 * Remove common upload artifacts from a trimmed line before classification.
 *
 * - Double (or more) semicolons, and any non-delimiter chars that follow them,
 *   are stripped. This covers patterns like `;;jsessionid=abc` in URL paths
 *   and stray `;;` in plain text lines.
 * - Trailing backslashes are removed (Windows path artifact commonly seen in
 *   .txt and .rtf exports).
 *
 * @param {string} trimmed — already trimmed input
 * @returns {string}
 */
function cleanLine(trimmed) {
  return trimmed
    .replace(/;{2,}[^/?#\s]*/g, '') // strip ;; + any non-delimiter chars after
    .replace(/\\+$/, '')             // strip trailing backslash(es)
    .trim();
}

/**
 * Attempt to classify a cleaned line as a URL.
 * Returns a UrlParse on success, or null if the line is not a web URL.
 *
 * Rules applied in order:
 * 1. Explicit http:// or https:// scheme → parse with new URL(); null if malformed.
 * 2. Any other explicit scheme (ftp:, mailto:, data:, …) → null (not a web link).
 * 3. No scheme → URL only when the candidate hostname contains a dot.
 *    `new URL('https://username')` succeeds, so the dot check prevents bare words,
 *    names, and usernames from being mis-classified.
 *
 * @param {string} cleaned — output of cleanLine()
 * @param {string} originalLine — raw trimmed line, preserved as-is in the record
 * @returns {UrlParse | null}
 */
function tryParseUrl(cleaned, originalLine) {
  // Rule 1: explicit http / https scheme
  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const u = new URL(cleaned);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        const normalized = normalizeUrl(u.href, NORMALIZE_OPTS);
        const nu = new URL(normalized);
        return {
          type: 'url',
          url: normalized,
          domain: nu.hostname,
          path: `${nu.pathname}${nu.search}${nu.hash}` || '/',
          originalLine,
        };
      }
    } catch { /* malformed */ }
    return null;
  }

  // Rule 2: any other explicit scheme → not a web link
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(cleaned)) return null;

  // Rule 3: no scheme — only promote if the potential hostname has a dot
  const potentialHost = cleaned.split('/')[0].split('?')[0].split('#')[0];
  if (potentialHost.includes('.')) {
    try {
      const u = new URL(`https://${cleaned}`);
      if (u.protocol === 'https:') {
        const normalized = normalizeUrl(u.href, NORMALIZE_OPTS);
        const nu = new URL(normalized);
        return {
          type: 'url',
          url: normalized,
          domain: nu.hostname,
          path: `${nu.pathname}${nu.search}${nu.hash}` || '/',
          originalLine,
        };
      }
    } catch { /* malformed */ }
  }

  return null;
}

/**
 * Parse a single line from a .txt / .rtf upload into a typed record.
 *
 * The raw line is cleaned of upload artifacts first (double semicolons,
 * trailing slashes). A line that reduces to nothing or a bare "/" is empty.
 * The original untouched line is preserved in URL records as `originalLine`.
 *
 * @param {string} line
 * @returns {EmptyParse | TextParse | UrlParse}
 */
export function parseLineToRecord(line) {
  const original = line.trim();
  if (!original) return { type: 'empty' };

  const cleaned = cleanLine(original);
  if (!cleaned || cleaned === '\\') return { type: 'empty' };

  const urlParse = tryParseUrl(cleaned, original);
  if (urlParse) return urlParse;

  return { type: 'text', content: cleaned };
}

/**
 * Stable short key for a text body (length + FNV-1a). Used for expand/collapse ids;
 * collisions are theoretically possible but unlikely for normal note-sized strings.
 * @param {string} content
 */
export function textContentGroupKey(content) {
  const len = content.length;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < content.length; i += 1) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${len}:${h.toString(16)}`;
}

/**
 * @param {string} content
 * @param {number} [max]
 */
export function textPreview(content, max = 50) {
  const t = content.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * @param {string[]} tags
 */
export function normalizeTagName(raw) {
  return raw.trim().toLowerCase();
}

/**
 * Dedupe tags case-insensitively, preserve first-seen casing.
 * @param {string[]} tags
 */
export function dedupeTags(tags) {
  const seen = new Map();
  for (const t of tags) {
    const s = t.trim();
    if (!s) continue;
    const key = normalizeTagName(s);
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

/**
 * @param {string} query raw filter string (may include tag: / domain: prefixes)
 */
export function parseFilterQuery(query) {
  const q = query.trim();
  if (!q) return { mode: 'all', needle: '' };
  const tagPrefix = 'tag:';
  const domainPrefix = 'domain:';
  if (q.toLowerCase().startsWith(tagPrefix)) {
    return { mode: 'tag', needle: q.slice(tagPrefix.length).trim() };
  }
  if (q.toLowerCase().startsWith(domainPrefix)) {
    return { mode: 'domain', needle: q.slice(domainPrefix.length).trim().toLowerCase() };
  }
  return { mode: 'all', needle: q.toLowerCase() };
}

/**
 * @param {{ mode: string, needle: string }} parsed
 * @param {object} urlRow
 * @param {object} textRow
 */
export function rowMatchesFilter(parsed, urlRow, textRow) {
  if (!parsed.needle && parsed.mode !== 'all') return true;
  if (parsed.mode === 'tag') {
    const n = normalizeTagName(parsed.needle);
    if (!n) return true;
    const tags = urlRow ? urlRow.tags || [] : textRow.tags || [];
    return tags.some((t) => normalizeTagName(t) === n || normalizeTagName(t).includes(n));
  }
  if (parsed.mode === 'domain') {
    if (!urlRow) return false;
    return (urlRow.domain || '').toLowerCase().includes(parsed.needle);
  }
  const n = parsed.needle;
  if (urlRow) {
    const hay = [
      urlRow.url,
      urlRow.description,
      urlRow.originalLine,
      urlRow.customHeader,
      ...(urlRow.tags || []),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    return hay.includes(n);
  }
  const hay = [textRow.content, textRow.description, ...(textRow.tags || [])]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return hay.includes(n);
}
