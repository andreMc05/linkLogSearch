import { dedupeTags, textPreview } from './url-utils.js';
import { bulkPut, bulkReplace, getAllUrls, getAllTexts, putText, putUrl } from './db.js';

export const EXPORT_SCHEMA_VERSION = 1;

/**
 * DUPLICATE / MERGE RULES (JSON import, merge mode)
 *
 * 1) URLs: two rows are duplicates if their normalized `url` string is identical
 *    (after trim). The incoming row is skipped as a new insert; tag lists are
 *    unioned onto the existing row (case-insensitive dedupe). Other fields on the
 *    existing row are left unchanged so local edits win.
 *
 * 2) Texts: duplicates if trimmed `content` matches exactly (case-sensitive).
 *    Same behavior: union tags onto the existing text row, skip insert.
 *
 * 3) Replace mode: all local urls/texts/tags are cleared first, then every row
 *    from the file is inserted. Rows keep `id` from the file when present and
 *    non-empty; otherwise a new id should be assigned by the caller.
 */

/**
 * @param {unknown} data
 */
export function parseExportPayload(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid JSON: expected an object');
  const obj = /** @type {Record<string, unknown>} */ (data);
  const urls = Array.isArray(obj.urls) ? obj.urls : [];
  const texts = Array.isArray(obj.texts) ? obj.texts : [];
  const tags = Array.isArray(obj.tags) ? obj.tags : [];
  return { urls, texts, tags, schemaVersion: obj.schemaVersion };
}

/**
 * Normalize an imported URL-shaped row (minimal validation).
 * @param {object} raw
 */
function normalizeImportedUrl(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url) return null;
  let domain = typeof raw.domain === 'string' ? raw.domain : '';
  let path = typeof raw.path === 'string' ? raw.path : '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!domain) domain = u.hostname;
    if (!path) path = `${u.pathname}${u.search}${u.hash}` || '/';
  } catch {
    return null;
  }
  const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined;
  return {
    id,
    url,
    originalLine: typeof raw.originalLine === 'string' ? raw.originalLine : url,
    domain,
    path,
    description: typeof raw.description === 'string' ? raw.description : url,
    customHeader: typeof raw.customHeader === 'string' ? raw.customHeader : '',
    tags: dedupeTags(Array.isArray(raw.tags) ? raw.tags.map(String) : []),
  };
}

/**
 * @param {object} raw
 */
function normalizeImportedText(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const content = typeof raw.content === 'string' ? raw.content.trim() : '';
  if (!content) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined;
  const description =
    typeof raw.description === 'string' && raw.description
      ? raw.description
      : textPreview(content);
  return {
    id,
    content,
    description,
    tags: dedupeTags(Array.isArray(raw.tags) ? raw.tags.map(String) : []),
  };
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Collapse duplicate URLs / texts inside a single import payload (union tags).
 * @param {object[]} urlRows
 */
function dedupeUrlRows(urlRows) {
  const m = new Map();
  for (const r of urlRows) {
    const prev = m.get(r.url);
    if (prev) {
      prev.tags = dedupeTags([...(prev.tags || []), ...(r.tags || [])]);
    } else {
      m.set(r.url, r);
    }
  }
  return [...m.values()];
}

/**
 * @param {object[]} textRows
 */
function dedupeTextRows(textRows) {
  const m = new Map();
  for (const r of textRows) {
    const prev = m.get(r.content);
    if (prev) {
      prev.tags = dedupeTags([...(prev.tags || []), ...(r.tags || [])]);
    } else {
      m.set(r.content, r);
    }
  }
  return [...m.values()];
}

/**
 * @param {'merge' | 'replace'} mode
 * @param {object} payload parsed { urls: unknown[], texts: unknown[] }
 */
export async function applyJsonImport(mode, payload) {
  let incomingUrls = payload.urls.map(normalizeImportedUrl).filter(Boolean);
  let incomingTexts = payload.texts.map(normalizeImportedText).filter(Boolean);
  incomingUrls = dedupeUrlRows(incomingUrls);
  incomingTexts = dedupeTextRows(incomingTexts);

  for (const r of incomingUrls) {
    if (!r.id) r.id = newId();
  }
  for (const r of incomingTexts) {
    if (!r.id) r.id = newId();
  }

  if (mode === 'replace') {
    await bulkReplace(incomingUrls, incomingTexts);
    return { addedUrls: incomingUrls.length, addedTexts: incomingTexts.length, merged: 0 };
  }

  const existingUrls = await getAllUrls();
  const existingTexts = await getAllTexts();

  const urlByKey = new Map(existingUrls.map((u) => [u.url, u]));
  const textByKey = new Map(existingTexts.map((t) => [t.content, t]));

  let merged = 0;
  const toAddUrls = [];
  const toAddTexts = [];

  for (const row of incomingUrls) {
    const prev = urlByKey.get(row.url);
    if (prev) {
      prev.tags = dedupeTags([...(prev.tags || []), ...(row.tags || [])]);
      await putUrl(prev);
      merged += 1;
    } else {
      toAddUrls.push(row);
      urlByKey.set(row.url, row);
    }
  }

  for (const row of incomingTexts) {
    const prev = textByKey.get(row.content);
    if (prev) {
      prev.tags = dedupeTags([...(prev.tags || []), ...(row.tags || [])]);
      prev.description = textPreview(prev.content);
      await putText(prev);
      merged += 1;
    } else {
      toAddTexts.push(row);
      textByKey.set(row.content, row);
    }
  }

  if (toAddUrls.length || toAddTexts.length) {
    await bulkPut(toAddUrls, toAddTexts);
  }

  return {
    addedUrls: toAddUrls.length,
    addedTexts: toAddTexts.length,
    merged,
  };
}

/**
 * @param {Awaited<ReturnType<typeof getAllUrls>>} urls
 * @param {Awaited<ReturnType<typeof getAllTexts>>} texts
 */
export function buildExportObject(urls, texts) {
  const tagSet = new Set();
  for (const u of urls) for (const t of u.tags || []) if (t && String(t).trim()) tagSet.add(String(t).trim());
  for (const x of texts) for (const t of x.tags || []) if (t && String(t).trim()) tagSet.add(String(t).trim());
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    urls,
    texts,
    tags: [...tagSet].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * @returns {string}
 */
export function defaultExportFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}`;
  return `link-logger-export_${stamp}.json`;
}
