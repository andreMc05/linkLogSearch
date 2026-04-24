# Link Logger

Offline-first single-page app for logging URLs and plain-text snippets. Upload `.txt`, `.rtf`, or `.json` files, browse by domain, tag, filter, edit, and export a portable JSON backup. All data lives in **IndexedDB** in your browser — no server, no build step.

---

## Quick start

The app uses ES modules and IndexedDB, both of which require a real HTTP origin (not `file://`).

```bash
# Python (stdlib)
python3 -m http.server 8080

# Node (npx)
npx serve .
```

Then open `http://localhost:8080/` in any modern browser.

---

## Stack

| Layer | Choice |
|---|---|
| Language | Vanilla JS — ES modules, no framework, no bundler |
| Persistence | IndexedDB (`js/db.js`) |
| Styles | Plain CSS with custom properties (`css/style.css`) |
| URL normalisation | `normalize-url` v9.0.0 — vendored at `js/vendor/normalize-url.js` |

---

## File map

| File | Role |
|---|---|
| `index.html` | Single page — all UI markup |
| `css/style.css` | All styles — CSS variables, dark mode, multi-column layout |
| `js/main.js` | Entry point — wires DOM, state, event listeners |
| `js/db.js` | All IndexedDB reads/writes; UUIDs via `crypto.randomUUID` |
| `js/render.js` | DOM-only list rendering (no `innerHTML` for user data) |
| `js/url-utils.js` | Line parsing, URL normalisation, filter logic, tag deduplication |
| `js/import-export.js` | JSON import (merge/replace) and export with `schemaVersion` |
| `js/rtf.js` | Best-effort RTF → plain-text stripper |
| `js/vendor/normalize-url.js` | Vendored copy of `normalize-url` v9.0.0 (MIT, 0 deps) |

---

## Data model

### URL row
```js
{
  id,           // crypto.randomUUID()
  url,          // normalised https URL (see below)
  originalLine, // raw trimmed line as it appeared in the upload file
  domain,       // hostname after normalisation (www. stripped)
  path,         // pathname + search + hash after normalisation
  description,  // display label (editable)
  customHeader, // optional batch-level header string
  tags,         // string[]
}
```

### Text row
```js
{
  id,
  content,     // trimmed plain-text body
  description, // first 50 chars of content (editable)
  tags,        // string[]
}
```

### Tags store
`keyPath: name` — rebuilt after every mutation via `rebuildTagIndex()`.

---

## Line parsing (`js/url-utils.js`)

Each non-empty line from a `.txt` or `.rtf` upload passes through three stages.

### Stage 1 — Artifact cleanup (`cleanLine`)

Before classification, common upload artifacts are stripped:

| Pattern | Removed |
|---|---|
| `;;` and any non-delimiter chars that follow | `;;jsessionid=abc` → `` |
| Trailing backslashes | `example.com\` → `example.com` |
| Line reduces to `\` after cleanup | treated as empty, skipped |

### Stage 2 — URL vs text classification (`tryParseUrl`)

Rules are applied in strict order:

| Rule | Condition | Result |
|---|---|---|
| 1 | Explicit `http://` or `https://` scheme | Try `new URL()` → URL on success, text if malformed |
| 2 | Any other explicit scheme (`ftp:`, `mailto:`, `data:`, …) | Text |
| 3 | No scheme, but candidate hostname **contains a dot** | Prepend `https://`, try `new URL()` → URL on success |
| — | Anything else (bare words, usernames, names) | Text |

The dot check in Rule 3 prevents single words and bare usernames from being mis-classified as URLs (e.g. `new URL('https://ariadna_cooper')` succeeds without it).

### Stage 3 — URL normalisation (`normalize-url` v9)

Every detected URL is passed through `normalizeUrl()` before storage:

| Normalisation | Example |
|---|---|
| Upgrade `http` → `https` | `http://example.com` → `https://example.com` |
| Strip `www.` | `www.github.com` → `github.com` |
| Remove `utm_*` query params | `?utm_source=email&id=42` → `?id=42` |
| Sort remaining query params | `?b=2&a=1` → `?a=1&b=2` |
| Remove trailing slash | `example.com/path/` → `example.com/path` |
| Strip `#:~:text=…` fragments | text-highlight anchors removed |
| Strip credentials | `user:pass@example.com` → `example.com` |

`originalLine` always preserves the raw line as uploaded.

---

## Export / import format

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-04-23T12:00:00.000Z",
  "urls": [ /* URL rows */ ],
  "texts": [ /* text rows */ ],
  "tags": ["sorted", "tag", "names"]
}
```

### Duplicate rules (merge import)

1. **URLs** — same normalised `url` → union incoming tags onto the existing record; skip insert.
2. **Texts** — same trimmed `content` → union tags only; skip insert.
3. **Replace mode** — clears all data first, then bulk-inserts. Rows with the same URL or text within the import file are collapsed (tags unioned) before insert.

`.txt` / `.rtf` upload skips lines that duplicate an existing URL or text (no tag merge for skipped lines).

---

## UI layout

- **Controls panel** — 3-column CSS grid: file picker / batch header / batch tags; action buttons; filter row
- **Browse tabs** — Links (grouped by domain) | Texts (grouped by identical content)
- **Groups** — CSS `column-count: 3` layout; expanding a group only shifts items below it in the same column
- Groups default to **collapsed**; map value `false` = expanded, absent/`true` = collapsed
- Responsive: 2 columns ≤ 860 px, 1 column ≤ 540 px

---

## Tests

```bash
node --test js/url-utils.test.js
```

Covers URL/text classification, normalisation, artifact cleanup, tag deduplication, and filter logic.

---

## Browser support

Modern evergreen browsers with IndexedDB, ES modules, and `crypto.randomUUID`. No polyfills included.
