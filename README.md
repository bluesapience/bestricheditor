# Best Rich Editor

**One library. Every editing style.**

Most rich text editors force you to pick one paradigm and stick with it. Best Rich Editor ships all three — structured block editing, Markdown with live preview, and WYSIWYG — behind a single, consistent API. Switch modes per editor instance. Mix them on the same page.

| Mode | What it is | When to use it |
|---|---|---|
| **BRE** | Block editor — drag-and-drop blocks, slash menu | Documents, wikis, structured content |
| **BREM** | Markdown editor — textarea + live preview | Developers, technical writers |
| **BREW** | WYSIWYG editor — formatting toolbar | Non-technical users, prose-heavy content |

- **Zero framework dependencies** — works with React, Vue, Svelte, Angular, or plain HTML
- **Two runtime deps** — [DOMPurify](https://github.com/cure53/DOMPurify) (XSS sanitization) + [KaTeX](https://katex.org/) (math, loaded lazily)
- **14 block types** — headings, lists, quotes, code, tables, images, audio, video, KaTeX formulas, multi-column layouts
- **Fully serializable** — `getJSON()` / `setJSON()` / `getHTML()` / `setHTML()` on every mode
- **Safe by default** — all HTML output sanitized via DOMPurify; URL injection prevented

---

## Installation

```bash
npm install bestricheditor
```

### CSS requirements

The editor needs **two stylesheets**:

| Stylesheet | What it covers | How it loads |
|---|---|---|
| `dist/bre.css` | Editor layout, blocks, toolbar | You import it (ESM) or it auto-injects (UMD) |
| KaTeX CSS | Math formula rendering | Auto-injected from jsDelivr CDN by the library |

**ESM build** — import the editor stylesheet yourself:

```js
import { createEditor } from 'bestricheditor';
import 'bestricheditor/dist/bre.css';
// KaTeX CSS is injected automatically from CDN when the editor mounts.
```

**UMD build** (`dist/bre.umd.js`) — both stylesheets are handled automatically; no imports needed.

**Self-hosting KaTeX CSS** — to avoid the CDN fetch (offline apps, strict CSP), load your own copy before the editor:

```html
<!-- Must have id="bre-katex-css" so the library skips its auto-inject -->
<link id="bre-katex-css" rel="stylesheet" href="/vendor/katex.min.css">
```

> **Note for direct ESM users (no bundler):** The ESM build code-splits KaTeX into `dist/chunks/`. Make sure your server also serves that directory so the lazy chunk can load.

---

## Quick start

### BRE — Block editor

Drag-and-drop blocks, slash menu, keyboard navigation, multi-column layout, undo/redo.

```js
import { createEditor } from 'bestricheditor';
import 'bestricheditor/dist/bre.css';

const editor = createEditor(document.getElementById('editor'), {
  mode: 'BRE',          // default, can be omitted
  onChange: (doc) => console.log('changed:', doc),
});

editor.setJSON(myDocument);

const doc  = editor.getJSON();   // structured JSON document
const html = editor.getHTML();   // sanitized HTML string

editor.destroy();
```

### BREM — Markdown editor

Write Markdown source; blur or click **Preview** to render. Click the preview to go back.

```js
const editor = createEditor(container, { mode: 'BREM' });
```

Supports: headings, bold/italic/code, lists, blockquotes, code fences, tables, links, images, audio, video, `$inline$` and `$$block$$` KaTeX math.

### BREW — WYSIWYG editor

Formatting toolbar, no Markdown knowledge required.

```js
const editor = createEditor(container, { mode: 'BREW' });
```

Toolbar includes: paragraph/heading selector, bold/italic/underline, bulleted list, numbered list, quote, code block, divider, link, KaTeX formula, table, image, audio, video.

---

## Options

```js
createEditor(container, {
  mode: 'BRE',                              // 'BRE' | 'BREM' | 'BREW'
  onChange: (doc) => {},                    // debounced callback on every change
  embedAllowlist: ['youtube.com', 'youtu.be', 'vimeo.com'],
  virtualize: false,                        // true = render only visible blocks
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `string` | `'BRE'` | Editor mode |
| `onChange` | `function` | `null` | Debounced callback receiving the current document |
| `embedAllowlist` | `string[]` | `['youtube.com','youtu.be','vimeo.com']` | Domains allowed as iframe embeds |
| `virtualize` | `boolean` | `false` | Virtualized rendering for large documents |

---

## API

All three modes expose the same five methods:

```js
editor.getJSON()        // → Document object
editor.setJSON(doc)     // loads a Document object
editor.getHTML()        // → sanitized HTML string
editor.setHTML(html)    // parse an HTML string and load it as blocks
editor.destroy()        // removes DOM, cleans up listeners
```

---

## Data model

`getJSON()` and `setJSON()` use this structure:

```js
// Document
{
  id: string,
  version: number,
  created: number,   // Unix ms
  updated: number,
  blocks: Block[],
}

// Block
{ id: string, type: string, data: object }
```

### Block types

Inline-capable blocks (`paragraph`, `heading`, `quote`, lists) store their content as sanitized HTML in the `html` field, preserving bold, italic, links, and other inline formatting.

| Type | Data shape |
|---|---|
| `paragraph` | `{ html: string }` |
| `heading` | `{ level: 1–6, html: string }` |
| `quote` | `{ html: string }` |
| `divider` | `{}` |
| `code` | `{ language?: string, code: string }` |
| `bulleted_list` | `{ html: string }` |
| `numbered_list` | `{ html: string }` |
| `formula` | `{ latex: string, displayMode: boolean }` |
| `table` | `{ rows: string[][] }` — first row is the header |
| `image` | `{ src: string, alt?: string, caption?: string }` |
| `audio` | `{ src: string, caption?: string }` |
| `video` | `{ src: string, caption?: string }` |
| `columns` | `{ columns: Block[][] }` — 2–4 column layout |
| `markdown` | `{ markdown: string }` — BREM mode only |

```js
// Example document
const doc = {
  id: 'my-doc',
  version: 1,
  created: Date.now(),
  updated: Date.now(),
  blocks: [
    { id: '1', type: 'heading',   data: { level: 1, html: 'Hello world' } },
    { id: '2', type: 'paragraph', data: { html: 'Rich text with <strong>bold</strong> and <em>italic</em>.' } },
    { id: '3', type: 'formula',   data: { latex: 'E = mc^2', displayMode: true } },
    { id: '4', type: 'table',     data: { rows: [['Name','Score'],['Alice','98'],['Bob','87']] } },
    { id: '5', type: 'image',     data: { src: 'https://example.com/photo.jpg', alt: 'Photo', caption: 'My photo' } },
    { id: '6', type: 'video',     data: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
  ],
};

editor.setJSON(doc);
```

---

## BRE — Block editor features

| Feature | Detail |
|---|---|
| Slash menu | Press `/` to open a searchable block inserter |
| Drag reorder | Drag the handle on the left of any block |
| Keyboard splitting | `Enter` splits a block; `Backspace` at start merges |
| Arrow navigation | `↑` / `↓` moves between blocks |
| Undo / redo | `⌘Z` / `Ctrl+Z` and `⌘⇧Z` / `Ctrl+Shift+Z` |
| Link insert | `⌘K` / `Ctrl+K` on selected text |
| Multi-column layout | Insert a **Columns** block (2, 3, or 4 columns); stacks on mobile |
| Virtualized rendering | Pass `{ virtualize: true }` for 500+ block documents |

---

## BREW — WYSIWYG keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘B` / `Ctrl+B` | Bold |
| `⌘I` / `Ctrl+I` | Italic |
| `⌘U` / `Ctrl+U` | Underline |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+Shift+Z` | Redo |

---

## Math (KaTeX)

Supported in all three modes. KaTeX JS is loaded as a lazy chunk; KaTeX CSS is auto-injected from jsDelivr CDN. Neither blocks the initial page render. See [Installation](#installation) if you need to self-host the CSS.

**BRE / BREW** — use the **∑ Formula** button, or supply a `formula` block via `setJSON`.

**BREM** — write `$inline$` or `$$display$$` in the textarea.

```js
{ type: 'formula', data: { latex: '\\int_0^\\infty e^{-x}\\,dx = 1', displayMode: true } }
```

---

## Video embeds

YouTube and Vimeo URLs are automatically converted to privacy-respecting iframes:

- YouTube → `youtube-nocookie.com/embed/…`
- Vimeo → `player.vimeo.com/video/…`

Other video URLs render as a native `<video>` element. Extend the allowlist with the `embedAllowlist` option.

---

## Virtualized rendering

For documents with hundreds of blocks:

```js
const editor = createEditor(container, { mode: 'BRE', virtualize: true });
```

Only blocks visible in the viewport (± 30 blocks) are in the DOM. A prefix-sum array gives O(log n) window lookups and O(1) spacer height calculations.

| Blocks | Standard `setJSON` | Virtualized `setJSON` |
|---|---|---|
| 500 | ~80–150 ms | ~10 ms |
| 1 000 | ~150–300 ms | ~10 ms |
| 5 000 | ~1–3 s | ~10 ms |

---

## Bundle size

| Artifact | Raw | Gzip |
|---|---|---|
| `dist/bre.esm.js` (initial) | 234 kb | **53 kb** |
| `dist/chunks/katex-*.js` (lazy) | 583 kb | 145 kb |
| `dist/bre.umd.js` (all-in-one) | 876 kb | 204 kb |
| `dist/bre.css` | 14 kb | 3 kb |

The ESM build code-splits KaTeX into a separate chunk that loads in parallel and is only fetched when needed. Consumers using Vite or webpack get further automatic splitting on top of this. The UMD build bundles everything for script-tag usage.

---

## Styling

The editor has no default outer padding — it fills whatever container you mount it in. Use CSS custom properties to theme it:

```css
:root {
  --bre-color-bg:          #ffffff;
  --bre-color-surface:     #f9fafb;
  --bre-color-text:        #111827;
  --bre-color-text-muted:  #6b7280;
  --bre-color-border:      #e5e7eb;
  --bre-color-accent:      #3b82f6;
  --bre-color-placeholder: #9ca3af;
  --bre-color-code-bg:     #1e1e2e;
  --bre-color-code-text:   #cdd6f4;
  --bre-color-quote-border:#3b82f6;
  --bre-font-sans:         system-ui, sans-serif;
  --bre-font-mono:         'SFMono-Regular', Consolas, monospace;
  --bre-radius:            6px;
  --bre-editor-max-width:  720px;
  --bre-editor-padding:    0;
}
```

To add padding around the editor, either set `--bre-editor-padding` or add padding/margin to the container element:

```css
/* Option A — CSS variable */
.my-editor-wrapper { --bre-editor-padding: 24px 32px; }

/* Option B — container padding */
.my-editor-wrapper { padding: 24px 32px; }
```

---

## Security

- All HTML output sanitized by **DOMPurify** before any `innerHTML` write
- Paste events fully sanitized regardless of source
- All `href` / `src` values validated — `javascript:` and `data:` URLs are rejected
- YouTube/Vimeo iframes use `sandbox`, `referrerpolicy`, and `loading="lazy"`
- No `eval()` anywhere in the codebase

---

## Browser support

Modern evergreen browsers (Chrome, Firefox, Safari, Edge). Requires ES2020+ and native ES Modules.

---

## License

MIT
