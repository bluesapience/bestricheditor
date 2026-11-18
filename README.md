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
- **A light default look, never on your content** — the editor's own UI (menus, popups, dialogs, buttons) has a neutral default you can change with a few `--bre-*` variables or switch off (`bre-base.css`); your text, headings, lists and code always inherit from your app
- **14 block types** — headings, lists, quotes, code, tables, images, audio, video, KaTeX formulas, multi-column layouts
- **Fully serializable** — `getJSON()` / `setJSON()` / `getHTML()` / `setHTML()` on every mode
- **Safe by default** — all HTML output sanitized via DOMPurify; URL injection prevented

---

## Installation

```bash
npm install bestricheditor
```

### CSS

| Stylesheet | What it covers | How to load |
|---|---|---|
| `bestricheditor/dist/bre.css` | Structure **+ a default look for the editor's own UI** (menus, popups, dialogs, buttons) | `import` it (ESM); auto-injected by the UMD build |
| `bestricheditor/base.css` | Structure only — no default look at all (use instead of `bre.css`) | `import 'bestricheditor/base.css'` |
| `bestricheditor/katex.css` | KaTeX styles + fonts (only needed if you render formulas) | `import 'bestricheditor/katex.css'` |

```js
import { createEditor } from 'bestricheditor';
import 'bestricheditor/dist/bre.css';
import 'bestricheditor/katex.css'; // optional: formulas only
```

**No stylesheet is ever fetched from a CDN by default.** If you prefer to host the KaTeX stylesheet yourself (or serve it from a CDN you control), pass `katexCssUrl` and the editor injects a `<link>` for it once:

```js
createEditor(el, { katexCssUrl: '/vendor/katex.min.css' });
```

### ESM and bundlers

The ESM build (`dist/bre.esm.js`) keeps `dompurify` and `katex` **external** (they are regular `dependencies`), so your bundler dedupes them. KaTeX is loaded with a dynamic `import('katex')`, so bundlers split it into its own lazy chunk automatically.

### Script tag / CDN (UMD)

```html
<script src="https://cdn.jsdelivr.net/npm/bestricheditor/dist/bre.umd.js"></script>
<script>
  const editor = bre.createEditor(document.getElementById('editor'));
</script>
```

The UMD core bundles DOMPurify but **not** KaTeX. On load it fetches `bre.katex.umd.js` from the same directory as `bre.umd.js` (resolved from its own script URL). To customise:

```html
<script>
  window.BRE_KATEX_URL = '/static/bre.katex.umd.js'; // self-host elsewhere
  // window.BRE_KATEX_URL = false;                   // opt out: no KaTeX, formulas stay as source text
</script>
<script src="bre.umd.js"></script>
```

(`window.BRE_KATEX_URL` must be set before `bre.umd.js` runs.) Add a CSP allowance for the KaTeX script origin accordingly.

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
  mode: 'BRE',                  // 'BRE' | 'BREM' | 'BREW'
  onChange: (doc) => {},        // debounced
  onReady: () => {},
  onFocus: () => {},
  onBlur: () => {},
  onSelectionChange: () => {},
  embedAllowlist: ['youtube.com', 'youtu.be', 'vimeo.com'],
  virtualize: 'auto',           // 'auto' | true | false
  readOnly: false,
  placeholder: 'Type / for commands',
  uploadImage: async (file) => url,
  katexCssUrl: '/vendor/katex.min.css',
  messages: { /* UI string overrides */ },
  dir: 'auto',                  // 'ltr' | 'rtl' | 'auto'
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `'BRE' \| 'BREM' \| 'BREW'` | `'BRE'` | Editor mode |
| `onChange` | `(doc) => void` | - | Debounced callback receiving the current document |
| `onReady` / `onFocus` / `onBlur` / `onSelectionChange` | `() => void` | - | Lifecycle callbacks (same as the matching events) |
| `embedAllowlist` | `string[]` | `['youtube.com','youtu.be','vimeo.com']` | Domains allowed as iframe embeds |
| `virtualize` | `'auto' \| boolean` | `'auto'` | Virtualized rendering for large documents (BRE) |
| `readOnly` | `boolean` | `false` | Render without editing affordances |
| `placeholder` | `string` | - | Placeholder text for empty content |
| `uploadImage` | `(file: File) => Promise<string>` | - | Called for pasted/dropped/picked images; resolve with the final URL |
| `katexCssUrl` | `string` | - | Opt-in: inject this KaTeX stylesheet URL (nothing is injected otherwise) |
| `messages` | `Partial<Record<string,string>>` | built-in English | Override UI strings |
| `dir` | `'ltr' \| 'rtl' \| 'auto'` | - | Text direction |

TypeScript definitions ship in `types/index.d.ts`.

---

## API

All modes expose the same methods:

```js
editor.getJSON()          // -> Document
editor.setJSON(doc)       // load a Document
editor.getHTML()          // -> sanitized HTML string
editor.setHTML(html)      // parse HTML and load it as blocks
editor.destroy()          // remove DOM, clean up listeners

editor.setReadOnly(true)  // toggle read-only at runtime
editor.isReadOnly()
editor.focus()
editor.blur()
editor.isEmpty()

const off = editor.on('change', (doc) => {});   // returns an unsubscribe function
editor.off('change', handler);
```

Events: `ready`, `change`, `focus`, `blur`, `selectionchange`.

### Custom blocks

```js
import { registerBlock } from 'bestricheditor';   // global; editor.registerBlock(def) is per instance

registerBlock({
  type: 'callout',
  render(data, ctx) { const el = document.createElement('div'); el.className = 'my-callout'; el.textContent = data.text ?? ''; return el; },
  serialize(el) { return { text: el.textContent ?? '' }; },
  toHTML(data) { return '<div class="my-callout">' + escapeHtml(String(data.text ?? '')) + '</div>'; },
  fromHTML(el) { return el.classList.contains('my-callout') ? { text: el.textContent ?? '' } : null; },
  slashMenu: { label: 'Callout', icon: '!', description: 'Highlighted note', keywords: ['note', 'info'] },
});
```

`toHTML` output is sanitized with DOMPurify before it is returned from `getHTML()`.

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
| Drag reorder | Drag the handle (`⋮⋮`) on the left of any block. Keyboard: `Alt+Shift+↑` / `↓` |
| Block menu | **Click** the handle (without dragging) or press `Alt+Shift+M`: Replace (media), Duplicate, Delete |
| Select media / divider | Click a loaded image, audio, video or divider to select it (outline, `data-bre-selected`); `Backspace` / `Delete` removes it, `Esc` deselects, `↑` / `↓` moves to the neighbouring block. Double-click media to replace its source |
| Delete a block | Select it and press `Delete`, use the block menu, or `⌘⇧⌫` / `Ctrl+Shift+Backspace` from anywhere inside it. Tables also have a **Delete table** button. All undoable |
| Inline toolbar | Select text → floating toolbar appears with Bold, Italic, Underline, Code, Link buttons |
| Keyboard splitting | `Enter` splits a block; `Backspace` at start merges |
| Arrow navigation | `↑` / `↓` moves between blocks |
| Add a line at the end | Click the empty space below the last block (adds a paragraph if the last block can't take text), or `↓` on a selected block / from a table's last row |
| Undo / redo | `⌘Z` / `Ctrl+Z` and `⌘⇧Z` / `Ctrl+Shift+Z` |
| Multi-column layout | Insert a **Columns** block (2, 3, or 4 columns); stacks on mobile |
| Virtualized rendering | `virtualize: 'auto'` (default) for large documents; `true` / `false` to force |

## BRE — Inline formatting keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘B` / `Ctrl+B` | Bold |
| `⌘I` / `Ctrl+I` | Italic |
| `⌘U` / `Ctrl+U` | Underline |
| `⌘/` / `Ctrl+/` | Inline code |
| `⌘K` / `Ctrl+K` | Link (prompts for URL) |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+Shift+Z` | Redo |

Buttons shown in the floating toolbar are context-aware — only the marks supported by the current block type appear (e.g. headings show Bold + Italic only; paragraphs show all five).

---

## BREW — selecting and deleting blocks

| Action | How |
|---|---|
| Select an image / audio / video / divider | Click it (outline, `data-bre-selected`) |
| Delete it | `Backspace` / `Delete` (undoable with `⌘Z`); `Esc` deselects |
| Edit media source, alt, caption | **Edit** button that floats over the block's top-left corner when it is selected or hovered (works for embedded video), `Enter` on the selected block, or double-click. The dialog also has **Remove**; there is a **Remove** button under the block too |
| Delete a table | **Delete table** button in the table controls |
| Add a line after a non-text last block | Click the empty space below it, or press `↓` on a selected block |
| Edit / remove a formula | Click it → dialog with **Remove** |

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

Supported in all three modes. KaTeX JS is always loaded lazily (dynamic `import('katex')` in ESM, `bre.katex.umd.js` in the UMD build). KaTeX CSS is **not** injected by default: import `bestricheditor/katex.css` or pass `katexCssUrl` (see [CSS](#css)).

**BRE / BREW**: use the **Formula** button, or supply a `formula` block via `setJSON`.

**BREM**: write `$inline$` or `$$display$$` in the textarea.

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
const editor = createEditor(container, { mode: 'BRE', virtualize: true }); // or 'auto' (default)
```

Only blocks visible in the viewport (± 30 blocks) are in the DOM. A prefix-sum array gives O(log n) window lookups and O(1) spacer height calculations.

| Blocks | Standard `setJSON` | Virtualized `setJSON` |
|---|---|---|
| 500 | ~80–150 ms | ~10 ms |
| 1 000 | ~150–300 ms | ~10 ms |
| 5 000 | ~1–3 s | ~10 ms |

---

## Bundle size

Measured on this repo's production build (minified, gzip level 9; see `npm run size`):

| Artifact | Raw | Min + gzip |
|---|---|---|
| `dist/bre.esm.js` (DOMPurify + KaTeX external) | 70.4 kB | **18.9 kB** |
| `dist/bre.umd.js` (core + bundled DOMPurify, no KaTeX) | 108.6 kB | **30.5 kB** |
| `dist/bre.katex.umd.js` (lazy, UMD only) | 252.6 kB | **76.0 kB** |
| `dist/bre.css` | 14.6 kB | 3.1 kB |
| `dist/katex.css` (+ 20 woff2 fonts, ~296 kB total) | 21.1 kB | 3.3 kB |

Sourcemaps (`*.map`) are published alongside every JS file. `npm run size` enforces limits (ESM 32 kB, UMD core 45 kB, KaTeX 80 kB).

---

## Styling

**Content is yours; the editor's own UI has a default look.**

- **Your content** (text, headings, paragraphs, lists, quotes, code, fonts, sizes) is never styled by the library — it inherits from your page.
- **The editor's own UI** — slash menu, block menu, floating toolbar, dialogs, action buttons, the selected-block outline, table/media controls, the drag-handle gutter — gets a neutral default look from `bre.css`. It uses system colors, so it is black-on-white on a light page and inverts automatically on a dark one (`color-scheme: dark`).
- Want none of it? Import **`bestricheditor/base.css`** instead of `bre.css`: structure only, plus the bare usability minimums (borders, an outline), all overridable.

### Change the look with variables

Set them on `:root` (the slash menu, block menu and floating toolbar are attached to `<body>`, so `:root` reaches everything):

```css
:root {
  --bre-accent: #2563eb;      /* buttons, active menu item, pressed toolbar buttons */
  --bre-accent-text: #fff;    /* text on the accent color */
  --bre-radius: 6px;          /* corner radius for editor UI (default: 0, square) */
}
```

| Variable | Controls | Default |
|---|---|---|
| `--bre-accent` | action buttons, active menu item, pressed toolbar buttons | `CanvasText` |
| `--bre-accent-text` | text on the accent color | `Canvas` |
| `--bre-surface` | popup / menu / dialog background | `Canvas` |
| `--bre-border` | hairlines around popups, tables, columns | soft `CanvasText` |
| `--bre-radius` | corner radius of editor UI | `0` |
| `--bre-shadow` | popup shadow | soft drop shadow |
| `--bre-pad` | base spacing unit for editor UI | `10px` |
| `--bre-focus` | selected-block outline color | `Highlight` |
| `--bre-gutter` | left space for the drag handle (BRE) | `1.75em` |
| `--bre-min-height` | writing-area height (all modes) | `300px` |
| `--bre-tail` | clickable space below the last block (click it to add a line at the end) | `3em` |

### Or just write CSS

The defaults are plain single-class selectors: strong enough that a CSS reset (`* { padding: 0 }`, Tailwind's `button { … }`) can't wipe them, and weak enough that your own rule for the same class (loaded after `bre.css`) wins — no `!important` needed. (The `--bre-*` defaults are the one exception: they sit at zero specificity, so your `:root { --bre-… }` always wins.)

```css
.bre-table-btn { background: rebeccapurple; }          /* beats the default */
.bre-quote { border-left: 3px solid rebeccapurple; }   /* content is yours anyway */
```

Useful hooks: `.bre-block--{type}`, `[data-bre-selected]` (selected media/divider), `.bre-slash-item[data-active="true"]` (active menu item), `.bre-table-controls` (shown only while editing a table), `.bre-media-controls`, `.bre-brew-link-dialog`, `[data-bre-readonly]`. Inspect the DOM for the rest.

---

## Content Security Policy

- No `eval()` / `new Function`.
- No external requests by default (no CDN stylesheet, no web fonts). With ESM + `katex.css`, everything is served from your own origin. KaTeX fonts are `font-src` resources.
- `katexCssUrl` and (UMD) `BRE_KATEX_URL` are opt-in; allow those origins in `style-src` / `script-src` if you use them.
- The UMD core injects its CSS through a `<style>` element, so it needs `style-src 'unsafe-inline'` (or a nonce-based setup); prefer the ESM build with the extracted `bre.css` under a strict CSP.
- Video embeds render sandboxed iframes limited to `embedAllowlist`; add those origins to `frame-src`.

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
