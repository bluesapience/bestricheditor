# Best Rich Editor

**One library. Every editing style.**

Most rich text editors force you to pick one paradigm and stick with it. Best Rich Editor ships all three — structured block editing, Markdown with live preview, and WYSIWYG — behind a single, consistent API. Switch modes per editor instance. Mix them on the same page.

| Mode | What it is | When to use it |
|---|---|---|
| **BRE** | Block editor — drag-and-drop blocks, slash menu | Documents, wikis, structured content |
| **BREM** | Markdown editor — textarea + live preview | Developers, technical writers |
| **BREW** | WYSIWYG editor — formatting toolbar | Non-technical users, prose-heavy content |

- **Zero framework dependencies** — works with React, Vue, Svelte, Angular, or plain HTML
- **Two runtime deps only** — [DOMPurify](https://github.com/cure53/DOMPurify) (XSS sanitization) + [KaTeX](https://katex.org/) (math rendering)
- **14 block types** — headings, lists, quotes, code, tables, images, audio, video, KaTeX formulas, 2-column layouts
- **Fully serializable** — `getJSON()` / `setJSON()` / `getHTML()` on every mode
- **Safe by default** — all HTML output sanitized via DOMPurify; URL injection prevented

---

## Installation

```bash
npm install bestricheditor
```

If you use the **ESM build**, also import the stylesheet:

```js
import 'bestricheditor/dist/bre.css';
```

The **UMD build** (`dist/bre.umd.js`) injects CSS automatically — no separate import needed.

---

## Quick start

### BRE — Block editor

Drag-and-drop blocks, slash menu, keyboard navigation, 2-column layout.

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

Every mode exposes the same four methods:

```js
editor.getJSON()        // → Document object
editor.setJSON(doc)     // loads a Document object
editor.getHTML()        // → sanitized HTML string
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

| Type | Data shape |
|---|---|
| `paragraph` | `{ text: string }` |
| `heading` | `{ level: 1–6, text: string }` |
| `quote` | `{ text: string }` |
| `divider` | `{}` |
| `code` | `{ language?: string, code: string }` |
| `bulleted_list` | `{ text: string }` |
| `numbered_list` | `{ text: string }` |
| `formula` | `{ latex: string, displayMode: boolean }` |
| `table` | `{ rows: string[][] }` — first row is the header |
| `image` | `{ src: string, alt?: string, caption?: string }` |
| `audio` | `{ src: string, caption?: string }` |
| `video` | `{ src: string, caption?: string }` |
| `columns` | `{ children: Block[][] }` — 2-column layout |
| `markdown` | `{ markdown: string }` — BREM mode only |

```js
// Example document
const doc = {
  id: 'my-doc',
  version: 1,
  created: Date.now(),
  updated: Date.now(),
  blocks: [
    { id: '1', type: 'heading',   data: { level: 1, text: 'Hello world' } },
    { id: '2', type: 'paragraph', data: { text: 'Rich text in the browser.' } },
    { id: '3', type: 'formula',   data: { latex: 'E = mc^2', displayMode: true } },
    { id: '4', type: 'table',     data: { rows: [['Name','Score'],['Alice','98'],['Bob','87']] } },
    { id: '5', type: 'image',     data: { src: 'https://example.com/photo.jpg', alt: 'Photo', caption: 'My photo' } },
    { id: '6', type: 'video',     data: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
  ],
};

editor.setJSON(doc);
```

The same document object works with `setJSON` in any mode — BRE, BREM, and BREW all read from and write to the same schema.

---

## BRE — Block editor features

| Feature | Detail |
|---|---|
| Slash menu | Press `/` to open a searchable block inserter |
| Drag reorder | Drag the handle on the left of any block |
| Keyboard splitting | `Enter` splits a block; `Backspace` at start merges |
| Arrow navigation | `↑` / `↓` moves between blocks |
| 2-column layout | Insert a **Columns** block; stacks on mobile |
| Virtualized rendering | Pass `{ virtualize: true }` for 500+ block documents |

---

## BREW — WYSIWYG keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘B` / `Ctrl+B` | Bold |
| `⌘I` / `Ctrl+I` | Italic |
| `⌘U` / `Ctrl+U` | Underline |

---

## Math (KaTeX)

Supported in all three modes.

**BRE / BREW** — use the **∑ Formula** toolbar button, or supply a `formula` block via `setJSON`.

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

---

## Styling

The editor uses CSS custom properties. Override on `:root` or your container:

```css
:root {
  --bre-font-family: system-ui, sans-serif;
  --bre-color-text:    #1a1a1a;
  --bre-color-surface: #ffffff;
  --bre-color-border:  #e0e0e0;
  --bre-color-accent:  #2563eb;
  --bre-color-muted:   #6b7280;
  --bre-radius:        6px;
}
```

---

## Security

- All HTML output sanitized by **DOMPurify** before any `innerHTML` write
- All `href` / `src` values validated — `javascript:` and `data:` URLs are rejected
- YouTube/Vimeo iframes use `sandbox`, `referrerpolicy`, and `loading="lazy"`
- No `eval()` anywhere in the codebase

---

## Browser support

Modern evergreen browsers (Chrome, Firefox, Safari, Edge). Requires ES2020+ and native ES Modules.

---

## License

MIT
