# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Best Rich Editor (BRE)** is a Notion-like rich text editor built with Native JavaScript (ES2020+ ES Modules) and Vanilla DOM — no TypeScript, no UI frameworks. It is published as an npm package and ships with a `demo/` folder for local development and testing.

Full spec: `ABOUT.md`

## Non-negotiables

- No TypeScript — plain ES2020+ JS with ES Modules
- No UI frameworks
- Minimal dependencies — DOMPurify and KaTeX are the only allowed runtime deps
- Build tool: **Rollup**
- Styling: **plain CSS with CSS variables**
- HTML sanitization: **DOMPurify** on all HTML output and pasted HTML — never raw `innerHTML`
- Math rendering: **KaTeX** for inline (`$...$`) and block (`$$...$$`) formulas

## Namespace conventions

All public-facing identifiers must be prefixed with `bre`:

- JS exported API: `bre.*`
- CSS classes: `.bre-*`
- DOM attributes: `data-bre-*`

## Build commands

```bash
npm install        # install dependencies
npm run dev        # Rollup watch + dev server at localhost:3000
npm run build      # production build via Rollup
npm run preview    # serve the dist build locally
```

## Build outputs

```
dist/bre.esm.js    # ES module build (tree-shakeable)
dist/bre.umd.js    # UMD build (script tag / CommonJS)
dist/bre.css       # extracted stylesheet
```

## Public API (stable contract)

```js
import { createEditor } from "bestricheditor";

const editor = createEditor(container, options);
editor.getJSON(); // returns Document object
editor.setJSON(json); // loads a Document object
editor.getHTML(); // returns sanitized HTML string
editor.destroy(); // tears down editor and cleans up
```

`options.mode` — `"BRE"` (default) | `"BREM"` | `"BREW"`
`options.embedAllowlist` — array of allowed embed domains (default: `['youtube.com','youtu.be','vimeo.com']`)
`options.virtualize` — `boolean`, enables virtualized rendering (default: `false`)
`options.onChange` — debounced callback fired on content change

## Data model

```js
// Document
{ id: string, version: number, created: number, updated: number, blocks: Block[] }

// Block
{ id: string, type: string, data: object, children?: Block[] }

// Block data shapes:
// paragraph:      { text: string }
// heading:        { level: 1..6, text: string }
// quote:          { text: string }
// divider:        {}
// code:           { language?: string, code: string }
// bulleted_list:  { text: string }
// numbered_list:  { text: string }
// formula:        { latex: string, displayMode: boolean }
// table:          { rows: string[][] }
// image:          { src: string, alt?: string, caption?: string }
// audio:          { src: string, caption?: string }
// video:          { src: string, caption?: string }
// columns:        { children: Block[][] }  — 2-col layout, children arrays per column
// markdown:       { markdown: string }     — BREM mode storage
```

The JSON model is the **source of truth**. The DOM is purely a view.

## Repository structure

```
src/
  bre.js              # library entry — exports createEditor
  bre.css             # all editor styles (imported by Rollup, emitted to dist/bre.css)
  core/
    editor.js         # Editor class, mounts/unmounts, owns event delegation root
    blockRegistry.js  # registry.register(type, plugin) / registry.get(type)
    renderer.js       # render/update blocks, dirty-flag diffing, document fragments
    state.js          # immutable document state, block CRUD helpers
    commands.js       # undo/redo command stack
    events.js         # internal event bus
  blocks/
    paragraph.js
    heading.js
    quote.js
    divider.js
    code.js
    bulletedList.js
    numberedList.js
    # later: formula.js, table.js, image.js, audio.js, video.js
  ui/
    slashMenu.js      # "/" menu — searchable block inserter
    dragHandle.js     # pointer-event drag reorder
    columns.js        # 2-column layout (desktop), stacked (mobile)
  utils/
    dom.js            # DOM helpers
    sanitize.js       # DOMPurify wrapper + URL sanitizer
    id.js             # generateId()
    debounce.js       # debounce()
demo/
  index.html          # demo page — "Best Rich Editor" header + editor + Export JSON/HTML buttons
  demo.js
  demo.css
dist/                 # Rollup output (gitignored)
```

## Block plugin interface

Each block registers with the block registry implementing:

```js
{
  // required
  render(block, ctx)   -> HTMLElement,
  toHTML(block)        -> string,
  validate(block)      -> boolean,

  // optional — part of the Block Capability layer (PROMPT-ARCH.md)
  capabilities: {
    inline: boolean,
    marks: string[],   // e.g. ["bold","italic","underline","code"]
    links: boolean,
  }
}
```

The editor core reads `capabilities` to decide which toolbar items, shortcuts, and paste transforms apply — without modifying block code.

## Editor modes

### BRE (default) — Notion-like block editor

- Block-based surface with slash menu (`/` to open, keyboard nav + search)
- Drag reorder via pointer events + drag handle
- Columns: 2-column layout block (desktop), stacks on mobile
- Keyboard: `Enter` splits, `Backspace` at start merges, arrows navigate between blocks

### BREM — Markdown mode (`options.mode = "BREM"`)

- `<textarea>` with auto-growing height (based on `scrollHeight`)
- Floating top-right button toggles "Preview" ↔ "Edit"
- Textarea `blur` OR clicking "Preview" → show rendered preview
- Clicking preview area OR "Edit" → back to textarea
- Internal markdown parser (no new deps): `#`–`######` headings, `-`/`*` bullets, `1.` numbered, `>` blockquote, ` ```lang ` fences, `---` divider, `` `code` `` inline, `[text](url)` links with URL sanitization
- KaTeX: `$...$` inline, `$$...$$` block
- All preview HTML sanitized with DOMPurify before DOM insertion
- `getJSON()` returns a `markdown` block `{ markdown: string }`; `setJSON()` restores textarea text

### BREW — WYSIWYG mode (`options.mode = "BREW"`)

- `contenteditable` surface with a Froala/TinyMCE-style toolbar
- Toolbar buttons: Paragraph, H1–H6, Bold, Italic, Underline, Bulleted list, Numbered list, Quote, Code block, Divider, Link (prompts for URL + sanitizes), Formula (prompts for LaTeX → KaTeX)
- No dangerous `innerHTML` — all DOM read/write via DOMPurify
- Paste interception: sanitize pasted HTML, strip unsafe attrs, convert to safe structure
- DOM → model sync is debounced (250–500 ms); `contenteditable` handles live typing
- `getJSON()` / `setJSON()` / `getHTML()` all work against the same block model

## Architecture upgrades (from PROMPT-ARCH.md)

Three planned upgrades to implement progressively after Stage 2:

### 1. Block Capability layer (Stage 3)

Declare per-plugin what the block supports. The editor core uses this to decide toolbar visibility, shortcuts, and paste behavior — without coupling logic into block files.

### 2. Transformation Pipeline (Stage 4)

```js
bre.transforms.register("paste", stepFn, { order: 20 });
bre.transforms.run("paste", payload, ctx);
```

Pipeline stages: `normalizeInput` → `sanitize` → `parse` → `optimize` → `serialize`
Enables pluggable "paste from Google Docs/Word" cleanup and custom importers/exporters.

### 3. Virtualized Rendering (Stage 5, opt-in)

```js
createEditor(container, { virtualize: true });
```

Keeps full JSON in memory, renders only visible ± 30 blocks. Spacers above/below maintain scroll height. Updates on scroll via `requestAnimationFrame`. Per-block cached heights for accurate spacer sizing.

## Build stages

| Stage | Branch   | Goal                                                                      |
| ----- | -------- | ------------------------------------------------------------------------- |
| 0     | `stage0` | Rollup build + demo shell (no blocks yet)                                 |
| 1     | —        | BRE core: block engine + 7 essential blocks + slash menu + drag + columns |
| 2     | —        | BREM (Markdown mode)                                                      |
| 3     | —        | BREW (WYSIWYG mode) + Block Capability layer                              |
| 4     | —        | Formula (KaTeX) + links + paste pipeline (transform pipeline)             |
| 5     | —        | Table + Image/Audio/Video + virtualized rendering + 500-block perf pass   |

## Security rules

- Never call `innerHTML =` without DOMPurify
- URL sanitize all `href`/`src` values (reject `javascript:`, `data:`)
- Embeds use `options.embedAllowlist` domain check + `sandbox`, `referrerpolicy`, `loading="lazy"` on all iframes
- No `eval()`

## Expected directory structure

```
src/
  index.js          # library entry — exports createEditor
  editor/           # core editor bootstrap
  blocks/           # one file per block type
  modes/            # bre.js, brem.js, brew.js
  registry.js       # block plugin registry
  model.js          # document + block helpers
  sanitize.js       # DOMPurify wrapper
  utils.js
demo/
  index.html        # demo page with "Best Rich Editor" header
  demo.js
dist/               # Rollup output (gitignored)
rollup.config.js
package.json
```
