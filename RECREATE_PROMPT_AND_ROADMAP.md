# Link Log Search — Recreate Prompt, Improvements, and Todo List

This file is for **rebuilding the app from scratch** (handoff to a human or AI), **prioritizing upgrades**, and **tracking work**.

---

## Prompt: Recreate “Link Logger” from scratch

Copy everything inside the block below into a new chat or ticket.

```text
Build a small single-page web app called “Link Logger” for personal use.

GOAL
- Ingest many URLs and plain-text snippets from uploaded files, organize them for browsing, tag them, filter them, edit them, and export a portable JSON backup.
- Prefer offline-first persistence in the browser (IndexedDB). No backend required for v1.

TECH STACK
- Static HTML + vanilla JavaScript + CSS (no build step required), OR optionally a minimal Vite + vanilla/TypeScript setup if you want type safety and modules—your choice, but keep deployability as “open index.html or static host.”

DATA MODEL
- URLs: id, url (normalized https), original line, domain, path, description (display text), optional customHeader, tags[].
- Texts: id, content, short description preview (~50 chars), tags[].
- Tags: unique names for autocomplete/suggestions; keep in sync with items.

FILE UPLOAD BEHAVIOR
- Multi-file input accepting .txt and .json.
- .txt: one record per non-empty line. If a line parses as http(s) URL (after trimming; prepend https:// if no scheme), store as URL; otherwise store as text.
- .json: same shape as export (urls[], texts[], optional tags[]). Merge or import with duplicate detection (same normalized URL or same text content policy—document the rule in code comments).
- Optional batch fields when uploading: custom header for URL display context; tags applied to all items in that upload batch.

UI / UX
- Title “Link Logger”.
- Message area for success/error/warning toasts (auto-dismiss).
- Controls: file picker, optional custom header + tag chips input (comma/Enter to add), “Upload Content” button.
- Second row: filter text box (searches URL, description, original, custom header, tags, text content), clear filter, export JSON, clear all data (confirm dialog).
- Main list: group URLs by hostname (domain); group all non-URL text under one section (e.g. “All Texts”). Section headers show counts; clicking header toggles expand/collapse of that group.
- Each row: render URL as link (target=_blank, rel=noopener) or text as paragraph; show tags; actions: Delete (confirm), “Open Incognito” (copy URL + instructions—browsers cannot force incognito), Copy (for text), Edit.
- Edit modal: for URLs—optional header + description; for texts—content only; tag editor with suggestions from existing tags. Save updates persistence and refreshes list.

PERSISTENCE
- IndexedDB schema: object stores urls (keyPath id, autoIncrement), texts (keyPath id, autoIncrement), tags (keyPath name). Indexes useful for domain and multiEntry tags if you query by tag later.
- On startup: open DB, load tags for suggestions, render all content.

EXPORT
- Download JSON file containing urls, texts, and tag list. Filename dated or fixed—your choice.

INTEGRATION NOTE (optional)
- If this lives inside a larger “util hub,” allow a pluggable nav include; otherwise ship standalone with a simple top nav or none.

QUALITY BAR
- Escape user-controlled strings when injecting into HTML to avoid XSS (URLs, descriptions, tags in innerHTML are risky—prefer textContent/createElement or a tiny escape helper).
- No reliance on inline onclick with raw URL strings in HTML attributes if they can contain quotes; bind events in JS.
- Remove debug console.log from production paths or guard behind a dev flag.
- README: how to open locally (file:// caveats for IndexedDB if any), export/import format, duplicate rules.

DELIVERABLES
- index.html, css/, js/ (or src/), sample export JSON optional.
- Short README with feature list and data format.
```

---

## Suggested improvements

### Correctness and safety

- **XSS hardening**: Avoid building list rows with `innerHTML` from URL/description/tag content without escaping; use DOM APIs or centralized escaping.
- **Event binding**: Replace `onclick="..."` string handlers with `addEventListener` and closures so quotes in URLs/text do not break the page (current “Copy Text” path is especially fragile).
- **Edit-save tag source**: In `v3.js`, `saveEditedItem` mixes UI tag chips (`currentEditTags`) with a comma-split text field for `item.tags`—unify on one source of truth (the chip set) and persist that array.

### Architecture

- **Single script entry**: `index.html` loads `v3.js` while `index.js`, `v2.js`, `new.js` look like forks; pick one persistence strategy, delete or archive dead variants, or document which is canonical.
- **Modules**: Split into small files (`db.js`, `importExport.js`, `render.js`, `tags.js`) or adopt TypeScript + Vite for maintainability.
- **Dependency on utilHub**: `index.html` references `../utilHub/...`; for a standalone repo, vendor those assets or make nav optional via config.

### UX and features

- **Import UX**: Dedicated “Import JSON” control (in addition to upload) with clear “merge vs replace” choice.
- **Filter**: Tag-only or domain-only filters; debounce input for large lists.
- **Keyboard**: Escape closes modal; Enter in modal saves (with guard).
- **Accessibility**: Focus trap in modal, `aria-modal`, labeled inputs, visible focus rings.
- **Mobile**: Touch-friendly hit targets; collapsible groups default state configurable.

### Data and portability

- **IDs**: Use UUIDs instead of sequential integers if you ever merge exports from two devices.
- **Version field**: Add `schemaVersion: 1` to export JSON for forward-compatible imports.

### Engineering hygiene

- **Tests**: Unit tests for `normalizeURL`, grouping, duplicate detection, and JSON round-trip.
- **Lint/format**: ESLint + Prettier in CI or pre-commit.
- **Dark mode**: Respect `prefers-color-scheme` using CSS variables (you already use variables in `style.css`).

---

## Todo list

Use this as a working checklist; reorder to match your priorities.

- [ ] **Decide canonical stack** — IndexedDB (`v3`) vs in-memory (`index.js`); remove or quarantine unused `v1`/`v2`/`new.js` after migration.
- [ ] **Fix tag persistence on edit** — Ensure saved tags match the tag chip UI in the active script (`v3.js` / `saveEditedItem`).
- [ ] **Harden rendering** — Escape or DOM-build for URL, description, header, tags, and clipboard paths; remove unsafe `innerHTML` patterns for user data.
- [ ] **Replace inline handlers** — Attach listeners in JS for delete, edit, incognito, copy.
- [ ] **Standalone mode** — Optional `index.standalone.html` without `utilHub` paths, or document required folder layout.
- [ ] **Import/export polish** — Explicit import button; merge vs replace; export filename with date; `schemaVersion` in JSON.
- [ ] **Debounce filter** — Reduce re-render churn on large datasets.
- [ ] **Accessibility pass** — Modal focus trap, labels, keyboard shortcuts, contrast check.
- [ ] **README** — Setup, file formats, duplicate rules, browser support.
- [ ] **Tests** — Core parsers and import/export at minimum.
- [ ] **Optional: Vite + TS** — If the script grows past ~800 lines, migrate incrementally.

---

*Generated from the current `linkLogger` workspace layout (HTML + CSS + `scripts/v3.js` as the loaded entry). Update this file as the app evolves.*
