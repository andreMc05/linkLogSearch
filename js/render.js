import { parseFilterQuery, rowMatchesFilter, textContentGroupKey, textPreview } from './url-utils.js';

/**
 * @param {string} url
 * @returns {string | null}
 */
function safeHttpUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {HTMLElement} el
 * @param {string} text
 */
function setText(el, text) {
  el.textContent = text;
}

/**
 * Groups default to collapsed. Map value `false` means expanded; missing or `true` means collapsed.
 * @param {Map<string, boolean>} collapsedDomains
 * @param {string} domain
 */
function isCollapsed(collapsedDomains, domain) {
  return collapsedDomains.get(domain) !== false;
}

/**
 * @typedef {'links' | 'texts'} BrowseTab
 */

/**
 * @param {object[]} texts
 * @returns {{ content: string, rows: object[] }[]}
 */
function groupTextsByUniqueContent(texts) {
  const map = new Map();
  for (const t of texts) {
    const c = t.content;
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(t);
  }
  return [...map.entries()]
    .map(([content, rows]) => ({ content, rows }))
    .sort((a, b) => a.content.localeCompare(b.content));
}

/**
 * @param {object[]} urls
 * @param {object[]} texts
 * @param {string} filterRaw
 * @param {Map<string, boolean>} collapsedDomains
 * @param {object} handlers
 * @param {{ browseTab: BrowseTab }} options
 */
export function renderList(root, urls, texts, filterRaw, collapsedDomains, handlers, options) {
  root.replaceChildren();
  const parsed = parseFilterQuery(filterRaw);
  const browseTab = options?.browseTab === 'texts' ? 'texts' : 'links';

  const filteredUrls = urls.filter((u) => rowMatchesFilter(parsed, u, null));
  const filteredTexts = texts.filter((t) => rowMatchesFilter(parsed, null, t));

  if (browseTab === 'links') {
    if (!filteredUrls.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent =
        urls.length && !filteredUrls.length
          ? 'No links match the current filter.'
          : 'No links yet. Upload a .txt, .json, or .rtf file, or switch to the Texts tab.';
      root.appendChild(empty);
      return;
    }

    const groups = document.createElement('div');
    groups.className = 'groups';

    const byDomain = new Map();
    for (const u of filteredUrls) {
      const d = u.domain || '(unknown)';
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d).push(u);
    }

    const sortedDomains = [...byDomain.keys()].sort((a, b) => a.localeCompare(b));
    for (const domain of sortedDomains) {
      groups.appendChild(
        buildDomainGroup(domain, byDomain.get(domain), collapsedDomains, handlers),
      );
    }

    root.appendChild(groups);
    return;
  }

  /* Texts tab */
  const shownGroups = groupTextsByUniqueContent(filteredTexts);

  if (!shownGroups.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = !texts.length
      ? 'No saved texts yet. Upload a .txt file with non-URL lines or import JSON.'
      : 'No texts match the current filter.';
    root.appendChild(empty);
    return;
  }

  const groups = document.createElement('div');
  groups.className = 'groups';

  for (const { content, rows } of shownGroups) {
    const collapseKey = `txu:${textContentGroupKey(content)}`;
    groups.appendChild(
      buildUniqueTextGroup(content, rows, collapseKey, collapsedDomains, handlers),
    );
  }

  root.appendChild(groups);
}

/**
 * @param {string} domain
 * @param {object[]} rows
 * @param {Map<string, boolean>} collapsedDomains
 * @param {object} handlers
 */
function buildDomainGroup(domain, rows, collapsedDomains, handlers) {
  const wrap = document.createElement('section');
  wrap.className = 'group';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'group-header';
  const collapsed = isCollapsed(collapsedDomains, domain);
  head.setAttribute('aria-expanded', (!collapsed).toString());

  const title = document.createElement('span');
  setText(title, domain);
  const count = document.createElement('span');
  count.className = 'group-count';
  setText(count, `${rows.length} link${rows.length === 1 ? '' : 's'}`);
  head.appendChild(title);
  head.appendChild(count);
  head.addEventListener('click', () => {
    handlers.onToggleGroup(domain);
  });

  const body = document.createElement('div');
  body.className = 'group-body';
  if (collapsed) body.hidden = true;

  for (const row of rows) {
    body.appendChild(buildUrlRow(row, handlers));
  }

  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

/**
 * @param {string} content
 * @param {object[]} rows
 * @param {string} collapseKey
 * @param {Map<string, boolean>} collapsedDomains
 * @param {object} handlers
 */
function buildUniqueTextGroup(content, rows, collapseKey, collapsedDomains, handlers) {
  const wrap = document.createElement('section');
  wrap.className = 'group';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'group-header';
  const collapsed = isCollapsed(collapsedDomains, collapseKey);
  head.setAttribute('aria-expanded', (!collapsed).toString());

  const preview = textPreview(content, 72);
  const title = document.createElement('span');
  setText(title, preview);
  const count = document.createElement('span');
  count.className = 'group-count';
  const n = rows.length;
  setText(count, n === 1 ? '1 entry' : `${n} copies (same text)`);
  head.appendChild(title);
  head.appendChild(count);
  head.addEventListener('click', () => {
    handlers.onToggleGroup(collapseKey);
  });

  const body = document.createElement('div');
  body.className = 'group-body';
  if (collapsed) body.hidden = true;

  if (rows.length === 1) {
    body.appendChild(buildTextRow(rows[0], handlers));
  } else {
    const shared = document.createElement('div');
    shared.className = 'text-group-shared';
    const p = document.createElement('p');
    p.className = 'item-text';
    setText(p, content);
    shared.appendChild(p);
    body.appendChild(shared);

    const variants = document.createElement('div');
    variants.className = 'text-group-variants';
    variants.setAttribute('role', 'list');
    for (const row of rows) {
      variants.appendChild(buildTextVariantRow(row, handlers));
    }
    body.appendChild(variants);
  }

  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

/**
 * @param {object} row
 * @param {object} handlers
 */
function buildUrlRow(row, handlers) {
  const el = document.createElement('article');
  el.className = 'row';

  const main = document.createElement('div');
  main.className = 'row-main';

  if (row.customHeader) {
    const hdr = document.createElement('div');
    hdr.className = 'row-meta';
    setText(hdr, row.customHeader);
    main.appendChild(hdr);
  }

  const safe = safeHttpUrl(row.url);
  const link = document.createElement(safe ? 'a' : 'span');
  link.className = 'item-link';
  if (safe) {
    link.href = safe;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  setText(link, row.description || row.url);

  const meta = document.createElement('div');
  meta.className = 'row-meta';
  setText(meta, row.originalLine && row.originalLine !== row.url ? row.originalLine : row.url);

  main.appendChild(link);
  main.appendChild(meta);
  main.appendChild(buildTagPills(row.tags));

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  actions.appendChild(
    iconButton('Edit', () => {
      handlers.onEditUrl(row);
    }),
  );
  actions.appendChild(
    iconButton('Copy URL', async () => {
      await handlers.onCopyUrl(row.url);
    }),
  );
  actions.appendChild(
    iconButton('Open Incognito', () => {
      handlers.onIncognito(row.url);
    }),
  );
  actions.appendChild(
    iconButton('Delete', () => {
      handlers.onDeleteUrl(row);
    }, true),
  );

  el.appendChild(main);
  el.appendChild(actions);
  return el;
}

/**
 * @param {object} row
 * @param {object} handlers
 */
function buildTextRow(row, handlers) {
  const el = document.createElement('article');
  el.className = 'row';

  const main = document.createElement('div');
  main.className = 'row-main';

  const p = document.createElement('p');
  p.className = 'item-text';
  setText(p, row.content);

  const meta = document.createElement('div');
  meta.className = 'row-meta';
  setText(meta, row.description || '');

  main.appendChild(p);
  main.appendChild(meta);
  main.appendChild(buildTagPills(row.tags));

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  actions.appendChild(
    iconButton('Edit', () => {
      handlers.onEditText(row);
    }),
  );
  actions.appendChild(
    iconButton('Copy', async () => {
      await handlers.onCopyText(row.content);
    }),
  );
  actions.appendChild(
    iconButton('Delete', () => {
      handlers.onDeleteText(row);
    }, true),
  );

  el.appendChild(main);
  el.appendChild(actions);
  return el;
}

/**
 * One DB row that shares the same body text as siblings; body shown above once.
 * @param {object} row
 * @param {object} handlers
 */
function buildTextVariantRow(row, handlers) {
  const el = document.createElement('article');
  el.className = 'row row-text-variant';
  el.setAttribute('role', 'listitem');

  const main = document.createElement('div');
  main.className = 'row-main';

  const badge = document.createElement('div');
  badge.className = 'row-meta';
  setText(badge, 'Tagged copy');
  main.appendChild(badge);
  main.appendChild(buildTagPills(row.tags));

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  actions.appendChild(
    iconButton('Edit', () => {
      handlers.onEditText(row);
    }),
  );
  actions.appendChild(
    iconButton('Copy', async () => {
      await handlers.onCopyText(row.content);
    }),
  );
  actions.appendChild(
    iconButton('Delete', () => {
      handlers.onDeleteText(row);
    }, true),
  );

  el.appendChild(main);
  el.appendChild(actions);
  return el;
}

/**
 * @param {string[]|undefined} tags
 */
function buildTagPills(tags) {
  const wrap = document.createElement('div');
  wrap.className = 'tag-list';
  for (const t of tags || []) {
    if (!t) continue;
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    setText(pill, t);
    wrap.appendChild(pill);
  }
  return wrap;
}

/**
 * @param {string} label
 * @param {() => void | Promise<void>} fn
 * @param {boolean} [danger]
 */
function iconButton(label, fn, danger) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = danger ? 'btn btn-danger' : 'btn btn-ghost';
  b.textContent = label;
  b.addEventListener('click', () => {
    void fn();
  });
  return b;
}
