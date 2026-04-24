import { dedupeTags, textPreview } from './url-utils.js';

const DB_NAME = 'link_logger';
const DB_VERSION = 1;

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = /** @type {IDBDatabase} */ (event.target.result);
      if (!db.objectStoreNames.contains('urls')) {
        const urls = db.createObjectStore('urls', { keyPath: 'id' });
        urls.createIndex('domain', 'domain', { unique: false });
        urls.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        urls.createIndex('url', 'url', { unique: false });
      }
      if (!db.objectStoreNames.contains('texts')) {
        const texts = db.createObjectStore('texts', { keyPath: 'id' });
        texts.createIndex('tags', 'tags', { unique: false, multiEntry: true });
      }
      if (!db.objectStoreNames.contains('tags')) {
        db.createObjectStore('tags', { keyPath: 'name' });
      }
    };
  });
}

let dbPromise;

export function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

/**
 * @template T
 * @param {IDBRequest<T>} req
 */
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @returns {Promise<string[]>}
 */
export async function getAllUrls() {
  const db = await getDb();
  const tx = db.transaction('urls', 'readonly');
  const store = tx.objectStore('urls');
  return reqToPromise(store.getAll());
}

/**
 * @returns {Promise<string[]>}
 */
export async function getAllTexts() {
  const db = await getDb();
  const tx = db.transaction('texts', 'readonly');
  return reqToPromise(tx.objectStore('texts').getAll());
}

/**
 * @returns {Promise<string[]>}
 */
export async function getTagNames() {
  const db = await getDb();
  const tx = db.transaction('tags', 'readonly');
  return reqToPromise(tx.objectStore('tags').getAllKeys());
}

/**
 * Rebuild the `tags` object store from union of tags on all urls and texts.
 */
export async function rebuildTagIndex() {
  const db = await getDb();
  const [urls, texts] = await Promise.all([getAllUrls(), getAllTexts()]);
  const set = new Set();
  for (const u of urls) for (const t of u.tags || []) if (t && t.trim()) set.add(t.trim());
  for (const x of texts) for (const t of x.tags || []) if (t && t.trim()) set.add(t.trim());

  const tx = db.transaction(['tags'], 'readwrite');
  const tagStore = tx.objectStore('tags');
  await reqToPromise(tagStore.clear());
  for (const name of set) {
    tagStore.put({ name });
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {object} row
 */
export async function putUrl(row) {
  const db = await getDb();
  const tx = db.transaction('urls', 'readwrite');
  tx.objectStore('urls').put(row);
  return transactionDone(tx).then(() => rebuildTagIndex());
}

/**
 * @param {object} row
 */
export async function putText(row) {
  const db = await getDb();
  const tx = db.transaction('texts', 'readwrite');
  tx.objectStore('texts').put(row);
  return transactionDone(tx).then(() => rebuildTagIndex());
}

/**
 * @param {IDBTransaction} tx
 */
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * @param {string} id
 */
export async function deleteUrl(id) {
  const db = await getDb();
  const tx = db.transaction('urls', 'readwrite');
  tx.objectStore('urls').delete(id);
  return transactionDone(tx).then(() => rebuildTagIndex());
}

/**
 * @param {string} id
 */
export async function deleteText(id) {
  const db = await getDb();
  const tx = db.transaction('texts', 'readwrite');
  tx.objectStore('texts').delete(id);
  return transactionDone(tx).then(() => rebuildTagIndex());
}

export async function clearAllData() {
  const db = await getDb();
  const tx = db.transaction(['urls', 'texts', 'tags'], 'readwrite');
  tx.objectStore('urls').clear();
  tx.objectStore('texts').clear();
  tx.objectStore('tags').clear();
  return transactionDone(tx);
}

/**
 * @param {object[]} urlRows
 * @param {object[]} textRows
 */
export async function bulkReplace(urlRows, textRows) {
  const db = await getDb();
  const tx = db.transaction(['urls', 'texts', 'tags'], 'readwrite');
  tx.objectStore('urls').clear();
  tx.objectStore('texts').clear();
  tx.objectStore('tags').clear();
  const urlStore = tx.objectStore('urls');
  const textStore = tx.objectStore('texts');
  for (const r of urlRows) urlStore.put(r);
  for (const r of textRows) textStore.put(r);
  await transactionDone(tx);
  return rebuildTagIndex();
}

/**
 * Append many rows in one transaction (faster than individual puts).
 * @param {object[]} urlRows
 * @param {object[]} textRows
 */
export async function bulkPut(urlRows, textRows) {
  const db = await getDb();
  const tx = db.transaction(['urls', 'texts'], 'readwrite');
  const urlStore = tx.objectStore('urls');
  const textStore = tx.objectStore('texts');
  for (const r of urlRows) urlStore.put(r);
  for (const r of textRows) textStore.put(r);
  await transactionDone(tx);
  return rebuildTagIndex();
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * @param {import('./url-utils.js').UrlParse} parsed
 * @param {string} [customHeader]
 * @param {string[]} batchTags
 */
export function buildUrlRow(parsed, customHeader, batchTags) {
  const tags = dedupeTags([...(batchTags || [])]);
  return {
    id: newId(),
    url: parsed.url,
    originalLine: parsed.originalLine,
    domain: parsed.domain,
    path: parsed.path,
    description: parsed.url,
    customHeader: customHeader || '',
    tags,
  };
}

/**
 * @param {string} content
 * @param {string[]} batchTags
 */
export function buildTextRow(content, batchTags) {
  const trimmed = content.trim();
  return {
    id: newId(),
    content: trimmed,
    description: textPreview(trimmed),
    tags: dedupeTags([...(batchTags || [])]),
  };
}