# Link Logger — Usage Guide

---

## Starting the app

Link Logger must be served over HTTP — it will not work when opened directly from the filesystem as a `file://` URL (IndexedDB and ES modules both require an HTTP origin).

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/` in your browser.

---

## Uploading files

### Supported formats

| Extension | How it is processed |
|---|---|
| `.txt` | One record per line — each line is classified as a URL or plain text |
| `.rtf` | Stripped to plain text first, then processed line-by-line like `.txt` |
| `.json` | Merged into existing data (see [Import JSON](#import-json)) |

Multiple files can be selected at once.

### Batch options (applied to every line in the upload)

- **Custom header** — a label shown above each URL row from this batch (useful for grouping by source or date)
- **Batch tags** — type a tag and press **Enter** or **,** to add it; tags are applied to all records in the batch

Click **Upload Content** to process.

---

## How lines are classified

Each non-empty line from a `.txt` or `.rtf` file goes through three steps.

### Step 1 — Artifact cleanup

Before classification, common artifacts are automatically removed:

| Artifact | What happens |
|---|---|
| Double semicolons `;;` (and any non-path characters that follow) | Stripped — e.g. `example.com/page;;jsessionid=abc` → `example.com/page` |
| Trailing backslashes `\` | Stripped — e.g. `some text\` → `some text` |
| A line that reduces to just `\` | Treated as empty and skipped |

### Step 2 — URL or text?

| Line looks like | Stored as |
|---|---|
| `https://example.com/path` | **URL** |
| `http://example.com` | **URL** (upgraded to `https` on save) |
| `example.com/path` | **URL** (has a dot in the hostname) |
| `www.example.com` | **URL** (www. is stripped on save) |
| `ariadna_cooper` | **Text** (no dot, single word) |
| `hello world` | **Text** |
| `mailto:a@b.com` | **Text** (non-http scheme) |
| `ftp://files.example.com` | **Text** (non-http scheme) |
| *(empty line)* | Skipped |

### Step 3 — URL normalisation

Detected URLs are cleaned before storage so that different spellings of the same page don't create duplicates:

| Before | After |
|---|---|
| `http://www.example.com/path/` | `https://example.com/path` |
| `https://example.com/?utm_source=email&id=42` | `https://example.com?id=42` |
| `https://example.com?b=2&a=1` | `https://example.com?a=1&b=2` |
| `https://example.com/page#:~:text=foo` | `https://example.com/page` |
| `https://user:pass@example.com` | `https://example.com` |

The original line as it appeared in the file is always preserved alongside the normalised URL.

---

## Browsing

### Links tab

URLs are grouped by **domain** (hostname after normalisation). Click a group header to expand or collapse it. All groups start collapsed.

### Texts tab

Plain-text entries are grouped by **identical content**. Groups with 2+ copies show a "N copies (same text)" badge.

---

## Filtering

The search box filters the active tab in real time (220 ms debounce).

| Query | What it matches |
|---|---|
| `github` | Any URL, description, original line, header, tag, or text content containing "github" |
| `tag:reading` | Records whose tags contain "reading" (substring match) |
| `domain:github.com` | URL records whose domain contains "github.com" |

Click **×** or clear the box to reset.

---

## Row actions

Each row has action buttons on the right:

| Button | Action |
|---|---|
| **Edit** | Opens a modal to edit description / custom header (URLs) or content (texts), and manage tags |
| **Copy URL** / **Copy** | Copies the URL or text content to the clipboard |
| **Open Incognito** | Copies the URL and shows instructions for pasting into a private window |
| **Delete** | Deletes the row after a confirmation prompt |

### Edit modal

- **URLs** — edit the custom header, description label, and tags
- **Texts** — edit the full content and tags
- Tag suggestions from your existing tag library are shown as clickable chips
- Press **Escape** to cancel; press **Ctrl + Enter** inside a text area to save

---

## Import JSON

Click **Import JSON** to load a previously exported (or hand-crafted) JSON file.

**Merge** (default) — adds new records; existing records with the same URL or text content are not duplicated — incoming tags are merged onto the existing record.

**Replace all** — deletes every existing record first, then imports the file.

---

## Export

Click **Export JSON** to download a dated backup:

```
link-logger-export_YYYY-MM-DD_HHMM.json
```

The file contains all URLs, texts, and tags. It can be re-imported on any device running Link Logger.

### Export format

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-04-23T12:00:00.000Z",
  "urls": [
    {
      "id": "…",
      "url": "https://example.com/docs",
      "originalLine": "example.com/docs",
      "domain": "example.com",
      "path": "/docs",
      "description": "Example documentation",
      "customHeader": "Batch label",
      "tags": ["demo", "docs"]
    }
  ],
  "texts": [
    {
      "id": "…",
      "content": "A plain-text note saved from a .txt file.",
      "description": "A plain-text note saved from a .tx…",
      "tags": ["note"]
    }
  ],
  "tags": ["demo", "docs", "note"]
}
```

---

## Clearing all data

Click **Clear all data** and confirm the prompt to permanently delete all URLs, texts, and tags from your browser's IndexedDB. This cannot be undone. Export first if you want a backup.

---

## Keyboard shortcuts

| Key | Context | Action |
|---|---|---|
| **Escape** | Modal open | Close without saving |
| **Ctrl + Enter** | Text area in edit modal | Save |
| **Enter** or **,** | Tag input | Add tag |
