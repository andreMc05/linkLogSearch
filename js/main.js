import { initTheme } from './theme.js';
import {
  buildExportObject,
  applyJsonImport,
  defaultExportFilename,
  parseExportPayload,
} from './import-export.js';
import {
  bulkPut,
  buildTextRow,
  buildUrlRow,
  clearAllData,
  deleteText,
  deleteUrl,
  getAllTexts,
  getAllUrls,
  getTagNames,
  putText,
  putUrl,
} from './db.js';
import { parseLineToRecord } from './url-utils.js';
import { rtfToPlainText } from './rtf.js';
import { renderList } from './render.js';

/** @type {string[]} */
let batchTags = [];
/** @type {string[]} */
let editTags = [];
/** @type {object | null} */
let editingTarget = null;
/** @type {'url' | 'text' | null} */
let editingKind = null;

const listRoot = document.getElementById('list-root');
const fileInput = document.getElementById('file-input');
const batchHeaderEl = document.getElementById('batch-header');
const batchTagInput = document.getElementById('batch-tag-input');
const batchChipsEl = document.getElementById('batch-chips');
const uploadBtn = document.getElementById('upload-btn');
const filterInput = document.getElementById('filter-input');
const clearFilterBtn = document.getElementById('clear-filter-btn');
const exportBtn = document.getElementById('export-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const importJsonBtn = document.getElementById('import-json-btn');
const importJsonInput = document.getElementById('import-json-input');
const toastRegion = document.getElementById('toast-region');
const modalRoot = document.getElementById('modal-root');

/** @type {Map<string, boolean>} */
const collapsedGroups = new Map();

/** @type {'links' | 'texts'} */
let browseTab = 'links';

let filterValue = '';
let filterDebounceTimer = 0;

const tabLinks = document.getElementById('tab-links');
const tabTexts = document.getElementById('tab-texts');
const filterHintLinks = document.getElementById('filter-hint-links');
const filterHintTexts = document.getElementById('filter-hint-texts');

const INCOGNITO_HINT =
  'URL copied. Paste into a private/incognito window (most browsers: Cmd+Shift+N or Ctrl+Shift+N). ' +
  'Sites cannot be forced into incognito from a normal page for security reasons.';

function showToast(message, variant = 'success', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${variant}`;
  el.textContent = message;
  toastRegion.appendChild(el);
  const t = window.setTimeout(() => {
    el.remove();
  }, ms);
  el.addEventListener('click', () => {
    window.clearTimeout(t);
    el.remove();
  });
}

function getImportMode() {
  const sel = document.querySelector('input[name="import-mode"]:checked');
  return sel && sel.value === 'replace' ? 'replace' : 'merge';
}

function renderBatchChips() {
  batchChipsEl.replaceChildren();
  for (const tag of batchTags) {
    batchChipsEl.appendChild(createChipEl(tag, () => {
      batchTags = batchTags.filter((x) => x !== tag);
      renderBatchChips();
    }));
  }
}

function renderEditChips() {
  const box = document.getElementById('edit-chips');
  if (!box) return;
  box.replaceChildren();
  for (const tag of editTags) {
    box.appendChild(
      createChipEl(tag, () => {
        editTags = editTags.filter((x) => x !== tag);
        renderEditChips();
      }),
    );
  }
}

/**
 * @param {string} tag
 * @param {() => void} onRemove
 */
function createChipEl(tag, onRemove) {
  const wrap = document.createElement('span');
  wrap.className = 'chip';
  wrap.textContent = tag;
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.setAttribute('aria-label', `Remove ${tag}`);
  rm.textContent = '×';
  rm.addEventListener('click', () => onRemove());
  wrap.appendChild(rm);
  return wrap;
}

/**
 * @param {string} raw
 * @param {'batch' | 'edit'} which
 */
function addTagsFromRaw(raw, which) {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const target = which === 'batch' ? batchTags : editTags;
  const set = new Set(target.map((t) => t.toLowerCase()));
  for (const p of parts) {
    const key = p.toLowerCase();
    if (set.has(key)) continue;
    set.add(key);
    target.push(p);
  }
  if (which === 'batch') renderBatchChips();
  else renderEditChips();
}

batchTagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const v = batchTagInput.value;
    if (v.trim()) {
      addTagsFromRaw(v, 'batch');
      batchTagInput.value = '';
    }
  }
});

batchTagInput.addEventListener('blur', () => {
  const v = batchTagInput.value;
  if (v.trim()) {
    addTagsFromRaw(v, 'batch');
    batchTagInput.value = '';
  }
});

function syncBrowseChrome() {
  const onTexts = browseTab === 'texts';
  tabLinks.setAttribute('aria-selected', (!onTexts).toString());
  tabTexts.setAttribute('aria-selected', onTexts.toString());
  filterHintLinks.classList.toggle('is-hidden', onTexts);
  filterHintTexts.classList.toggle('is-hidden', !onTexts);
  filterInput.placeholder = onTexts
    ? 'Search text, tags, description… (tag: / domain: still work)'
    : 'Search… or tag:name / domain:host';
}

tabLinks.addEventListener('click', () => {
  browseTab = 'links';
  syncBrowseChrome();
  void refreshList();
});

tabTexts.addEventListener('click', () => {
  browseTab = 'texts';
  syncBrowseChrome();
  void refreshList();
});


async function refreshList() {
  syncBrowseChrome();
  const [urls, texts] = await Promise.all([getAllUrls(), getAllTexts()]);
  const handlers = {
    onToggleGroup: (key) => {
      const collapsed = collapsedGroups.get(key) !== false;
      collapsedGroups.set(key, !collapsed);
      void refreshList();
    },
    onEditUrl: (row) => openEditModal('url', row),
    onEditText: (row) => openEditModal('text', row),
    onDeleteUrl: (row) => {
      if (!window.confirm('Delete this link?')) return;
      void deleteUrl(row.id).then(() => {
        showToast('Link deleted.', 'success');
        void refreshList();
      });
    },
    onDeleteText: (row) => {
      if (!window.confirm('Delete this text entry?')) return;
      void deleteText(row.id).then(() => {
        showToast('Text deleted.', 'success');
        void refreshList();
      });
    },
    onCopyUrl: async (url) => {
      try {
        await navigator.clipboard.writeText(url);
        showToast('URL copied to clipboard.', 'success');
      } catch {
        showToast('Clipboard unavailable.', 'warning');
      }
    },
    onCopyText: async (content) => {
      try {
        await navigator.clipboard.writeText(content);
        showToast('Text copied to clipboard.', 'success');
      } catch {
        showToast('Clipboard unavailable.', 'warning');
      }
    },
    onIncognito: async (url) => {
      try {
        await navigator.clipboard.writeText(url);
        showToast(INCOGNITO_HINT, 'warning', 9000);
      } catch {
        showToast('Could not copy URL for incognito flow.', 'error');
      }
    },
  };
  renderList(listRoot, urls, texts, filterValue, collapsedGroups, handlers, { browseTab });
}

function scheduleFilterRefresh() {
  window.clearTimeout(filterDebounceTimer);
  filterDebounceTimer = window.setTimeout(() => {
    void refreshList();
  }, 220);
}

filterInput.addEventListener('input', () => {
  filterValue = filterInput.value;
  scheduleFilterRefresh();
});

clearFilterBtn.addEventListener('click', () => {
  filterInput.value = '';
  filterValue = '';
  void refreshList();
});

exportBtn.addEventListener('click', async () => {
  const [urls, texts] = await Promise.all([getAllUrls(), getAllTexts()]);
  const payload = buildExportObject(urls, texts);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultExportFilename();
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  showToast('Export started.', 'success', 2800);
});

clearAllBtn.addEventListener('click', async () => {
  if (!window.confirm('Delete ALL saved links, texts, and tags from this browser?')) return;
  try {
    await clearAllData();
    collapsedGroups.clear();
    showToast('All local data cleared.', 'success');
    void refreshList();
  } catch (e) {
    showToast(`Could not clear data: ${e && e.message ? e.message : 'error'}`, 'error');
  }
});

importJsonBtn.addEventListener('click', () => {
  importJsonInput.value = '';
  importJsonInput.click();
});

importJsonInput.addEventListener('change', async () => {
  const f = importJsonInput.files && importJsonInput.files[0];
  if (!f) return;
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    const payload = parseExportPayload(data);
    const mode = getImportMode();
    const res = await applyJsonImport(mode, payload);
    showToast(
      `Import complete (${mode}). Added ${res.addedUrls} URL(s), ${res.addedTexts} text(s); merged ${res.merged} duplicate(s).`,
      'success',
      6500,
    );
    void refreshList();
  } catch (e) {
    showToast(`Import failed: ${e && e.message ? e.message : 'invalid JSON'}`, 'error');
  }
});

/**
 * @param {string} plain one line per record (same rules as .txt)
 * @param {string} batchHeader
 */
async function ingestPlainLines(plain, batchHeader) {
  const existingUrls = await getAllUrls();
  const existingTexts = await getAllTexts();
  const urlSeen = new Set(existingUrls.map((u) => u.url));
  const textSeen = new Set(existingTexts.map((t) => t.content));
  const newUrls = [];
  const newTexts = [];
  for (const line of plain.split(/\r?\n/)) {
    const p = parseLineToRecord(line);
    if (p.type === 'empty') continue;
    if (p.type === 'url') {
      if (urlSeen.has(p.url)) continue;
      urlSeen.add(p.url);
      newUrls.push(buildUrlRow(p, batchHeader, batchTags));
    } else {
      const c = p.content.trim();
      if (!c || textSeen.has(c)) continue;
      textSeen.add(c);
      newTexts.push(buildTextRow(c, batchTags));
    }
  }
  if (newUrls.length || newTexts.length) {
    await bulkPut(newUrls, newTexts);
  }
  return { addedUrls: newUrls.length, addedTexts: newTexts.length, merged: 0 };
}

/**
 * @param {File} file
 * @param {string} batchHeader
 */
async function ingestFile(file, batchHeader) {
  const name = file.name.toLowerCase();
  const text = await file.text();
  if (name.endsWith('.json')) {
    const data = JSON.parse(text);
    const payload = parseExportPayload(data);
    return applyJsonImport('merge', payload);
  }
  if (name.endsWith('.txt')) {
    return ingestPlainLines(text, batchHeader);
  }
  if (name.endsWith('.rtf')) {
    return ingestPlainLines(rtfToPlainText(text), batchHeader);
  }
  throw new Error(`Unsupported file type: ${file.name}`);
}

uploadBtn.addEventListener('click', async () => {
  const files = fileInput.files;
  if (!files || !files.length) {
    showToast('Choose one or more files first.', 'warning');
    return;
  }
  const header = batchHeaderEl.value.trim();
  let totalAddedU = 0;
  let totalAddedT = 0;
  let totalMerged = 0;
  try {
    for (const f of files) {
      const res = await ingestFile(f, header);
      totalAddedU += res.addedUrls;
      totalAddedT += res.addedTexts;
      totalMerged += res.merged || 0;
    }
    showToast(
      `Upload finished. Added ${totalAddedU} URL(s), ${totalAddedT} text(s); merge events ${totalMerged}.`,
      'success',
      6500,
    );
    fileInput.value = '';
    void refreshList();
  } catch (e) {
    showToast(`Upload failed: ${e && e.message ? e.message : 'error'}`, 'error');
  }
});

/** @type {(() => void) | null} */
let disposeModalTrap = null;
/** @type {HTMLElement | null} */
let lastFocus = null;

function closeModal() {
  if (disposeModalTrap) {
    disposeModalTrap();
    disposeModalTrap = null;
  }
  modalRoot.hidden = true;
  modalRoot.replaceChildren();
  editingTarget = null;
  editingKind = null;
  if (lastFocus) {
    lastFocus.focus();
    lastFocus = null;
  }
}

/**
 * @param {'url' | 'text'} kind
 * @param {object} row
 */
function openEditModal(kind, row) {
  lastFocus = /** @type {HTMLElement} */ (document.activeElement);
  editingTarget = row;
  editingKind = kind;
  editTags = [...(row.tags || [])];

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'edit-modal-title');

  const title = document.createElement('h2');
  title.id = 'edit-modal-title';
  title.textContent = kind === 'url' ? 'Edit link' : 'Edit text';

  const form = document.createElement('form');
  form.noValidate = true;

  if (kind === 'url') {
    const hLabel = document.createElement('label');
    hLabel.className = 'field';
    hLabel.htmlFor = 'edit-header';
    hLabel.textContent = 'Custom header';
    const hInput = document.createElement('input');
    hInput.id = 'edit-header';
    hInput.type = 'text';
    hInput.value = row.customHeader || '';
    hLabel.appendChild(hInput);
    form.appendChild(hLabel);

    const dLabel = document.createElement('label');
    dLabel.className = 'field';
    dLabel.htmlFor = 'edit-desc';
    dLabel.textContent = 'Description (link label)';
    const dInput = document.createElement('input');
    dInput.id = 'edit-desc';
    dInput.type = 'text';
    dInput.value = row.description || row.url;
    dLabel.appendChild(dInput);
    form.appendChild(dLabel);
  } else {
    const cLabel = document.createElement('label');
    cLabel.className = 'field';
    cLabel.htmlFor = 'edit-content';
    cLabel.textContent = 'Content';
    const cInput = document.createElement('textarea');
    cInput.id = 'edit-content';
    cInput.value = row.content || '';
    cLabel.appendChild(cInput);
    form.appendChild(cLabel);
  }

  const tagWrap = document.createElement('div');
  tagWrap.className = 'field chip-input-wrap';
  const tagLbl = document.createElement('label');
  tagLbl.htmlFor = 'edit-tag-input';
  tagLbl.textContent = 'Tags';
  const chipBox = document.createElement('div');
  chipBox.className = 'chip-input';
  const editChips = document.createElement('div');
  editChips.id = 'edit-chips';
  editChips.className = 'chip-list';
  const tagInput = document.createElement('input');
  tagInput.id = 'edit-tag-input';
  tagInput.type = 'text';
  tagInput.autocomplete = 'off';
  tagInput.placeholder = 'Comma or Enter';
  chipBox.appendChild(editChips);
  chipBox.appendChild(tagInput);
  tagWrap.appendChild(tagLbl);
  tagWrap.appendChild(chipBox);
  form.appendChild(tagWrap);

  const sugWrap = document.createElement('div');
  sugWrap.className = 'field';
  const sugLbl = document.createElement('span');
  sugLbl.textContent = 'Suggestions';
  sugLbl.style.fontSize = '0.8rem';
  sugLbl.style.color = 'var(--muted)';
  sugLbl.style.fontWeight = '600';
  const sugList = document.createElement('div');
  sugList.className = 'suggestions';
  sugWrap.appendChild(sugLbl);
  sugWrap.appendChild(sugList);
  form.appendChild(sugWrap);

  void getTagNames().then((names) => {
    const exclude = new Set(editTags.map((t) => t.toLowerCase()));
    for (const n of names) {
      if (exclude.has(String(n).toLowerCase())) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'suggestion';
      b.textContent = String(n);
      b.addEventListener('click', () => {
        addTagsFromRaw(String(n), 'edit');
      });
      sugList.appendChild(b);
    }
  });

  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = tagInput.value;
      if (v.trim()) {
        addTagsFromRaw(v, 'edit');
        tagInput.value = '';
      }
    }
  });

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-ghost';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => closeModal());
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn-primary';
  save.textContent = 'Save';
  actions.appendChild(cancel);
  actions.appendChild(save);
  form.appendChild(actions);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void saveEditedItem(form);
  });

  modal.appendChild(title);
  modal.appendChild(form);
  backdrop.appendChild(modal);
  modalRoot.replaceChildren(backdrop);
  modalRoot.hidden = false;

  renderEditChips();

  const focusableSel =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
  const trap = (e) => {
    if (e.key !== 'Tab') return;
    const nodes = [...modal.querySelectorAll(focusableSel)].filter(
      (n) => /** @type {HTMLElement} */ (n).offsetParent !== null,
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
    if (e.key === 'Enter' && e.ctrlKey && e.target instanceof HTMLTextAreaElement) {
      e.preventDefault();
      void saveEditedItem(form);
    }
  };
  modal.addEventListener('keydown', trap);
  modal.addEventListener('keydown', onKey);
  disposeModalTrap = () => {
    modal.removeEventListener('keydown', trap);
    modal.removeEventListener('keydown', onKey);
  };

  const firstField = form.querySelector('input, textarea');
  if (firstField instanceof HTMLElement) firstField.focus();
}

/**
 * @param {HTMLFormElement} form
 */
async function saveEditedItem(form) {
  if (!editingTarget || !editingKind) return;
  const tagInput = /** @type {HTMLInputElement | null} */ (form.querySelector('#edit-tag-input'));
  if (tagInput && tagInput.value.trim()) {
    addTagsFromRaw(tagInput.value, 'edit');
    tagInput.value = '';
  }

  if (editingKind === 'url') {
    const h = /** @type {HTMLInputElement} */ (form.querySelector('#edit-header'));
    const d = /** @type {HTMLInputElement} */ (form.querySelector('#edit-desc'));
    editingTarget.customHeader = h.value.trim();
    editingTarget.description = d.value.trim() || editingTarget.url;
    editingTarget.tags = [...editTags];
    await putUrl(editingTarget);
  } else {
    const c = /** @type {HTMLTextAreaElement} */ (form.querySelector('#edit-content'));
    const content = c.value.trim();
    if (!content) {
      showToast('Text content cannot be empty.', 'warning');
      return;
    }
    editingTarget.content = content;
    editingTarget.description =
      content.length <= 50 ? content : `${content.slice(0, 50)}…`;
    editingTarget.tags = [...editTags];
    await putText(editingTarget);
  }

  showToast('Saved.', 'success');
  closeModal();
  void refreshList();
}

async function boot() {
  initTheme();
  renderBatchChips();
  syncBrowseChrome();
  try {
    await getAllUrls();
    await refreshList();
  } catch (e) {
    showToast(
      `Database could not open: ${e && e.message ? e.message : 'error'}. Try a local http(s) URL if you opened this file directly.`,
      'error',
      12000,
    );
  }
}

void boot();
