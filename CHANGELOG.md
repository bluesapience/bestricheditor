# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Notion-style block selection and menu**: click image/audio/video/divider to select, `Backspace`/`Delete` removes; click the drag handle (or `Alt+Shift+M`) for a Replace / Duplicate / Delete menu; double-click media to replace. A single click on loaded media no longer opens the URL prompt (empty placeholders still do).
- **BREW block deletion**: clicking an image/audio/video/divider selects it (`Backspace`/`Delete` removes it via the browser's undo-able delete, `Esc` deselects, `Enter` or double-click edits media); media and formula dialogs have a **Remove** button; tables have a **Delete table** button; formulas edit in a dialog instead of `window.prompt`.
- **Delete a block**: "Delete table" button, `Ctrl/Cmd+Shift+Backspace` on any block, and Backspace at the start of the block after a divider.
- **Read-only mode** (`readOnly` option, `setReadOnly()` / `isReadOnly()`) in all three modes.
- **Placeholder** option for all modes (shown in an empty editor).
- **Image upload hook** `uploadImage(file) => Promise<string>` for paste, drop and the slash menu / click picker (BRE); URLs are sanitized, failures emit `error`.
- **Events**: `on()` / `off()` plus `onReady`, `onFocus`, `onBlur`, `onSelectionChange`, `onError` in all modes; `focus()`, `blur()`, `isEmpty()`.
- **Custom blocks**: `registerBlock(def)` (also `editor.registerBlock`) with `render`, `serialize`, `toHTML`, `fromHTML`, slash-menu entry.
- **Versioned schema**: `migrateDocument()` and `CURRENT_VERSION`; older/missing versions are migrated on `setJSON`, newer ones load best-effort with a warning.
- **i18n**: `messages` option (all UI strings), `dir` option (`ltr` | `rtl` | `auto`).
- **Accessibility**: ARIA roles/labels, listbox slash menu with `aria-activedescendant`, live-region announcements, keyboard block move (Alt+Shift+Arrow).
- **Paste pipeline**: Word / Google Docs cleanup, nested-list flattening, Markdown-text paste, multi-line plain-text paste; hostile HTML dropped on drop events too.
- `virtualize: 'auto'` (new default) with `virtualizeThreshold` (default 300).
- Block ↔ Markdown conversion (`blocksToMarkdown`, `markdownToBlocks`); BREM `getJSON({ as: 'blocks' })`.
- Tests (`npm test`, 49 tests: core, BRE, cross-mode round-trips, XSS fixtures).
- Hand-written TypeScript definitions (`types/index.d.ts`, exposed via `exports` / `types`).
- Sourcemaps for all production JS outputs, published in the package.
- `bestricheditor/katex.css` export: KaTeX stylesheet plus woff2 fonts (`dist/katex.css`, `dist/fonts/`).
- `dist/bre.katex.umd.js`: separate, lazily loaded KaTeX bundle for the UMD/CDN build (override with `window.BRE_KATEX_URL`, opt out with `false`).
- `setKaTeXCssUrl()` / `options.katexCssUrl` opt-in for injecting a KaTeX stylesheet.
- `size-limit` budgets (`npm run size`), `npm run bench` (jsdom benchmark with `--write` / `--check` baselines), `npm test` runner.
- CI workflow, CONTRIBUTING, CODE_OF_CONDUCT, issue and PR templates.

### Fixed
- **Adding a line at the end of the document**: in BRE, clicking the empty space below the last block puts the caret there, or adds a new paragraph when the last block can't take text (image, audio, video, table, divider, code, formula); `↓` on a selected last block and `↓` from a table's last row do the same (`↑` from the first row moves up). BREW gets the table arrows too, and its end-of-document paragraph no longer depends on `execCommand('insertHTML')`. The theme reserves a clickable tail below the content (`--bre-tail`, default 3em; the editor also has a `--bre-min-height`), so there is always somewhere to click even in a long document.
- Table controls (add/remove row/column, delete table) are shown only while the caret is inside the table, in BRE and BREW. In BRE, focus is restored to a cell after each action so the controls stay up.
- BREW: the media and formula edit dialogs now span the width of the block they edit (min 280 px, never wider than the editor).
- BREW: you can add a line at the end of the document when the last block is an image, audio, video, table, divider or code block — click the empty space below it, or press `↓` on the selected block (also selects/moves between neighbouring blocks).
- BREW: media **Edit / Remove** buttons now float over the block's top-left corner when it is selected or hovered (instead of sitting permanently underneath).
- BREW: media dialog opens with its top-left corner on the block's top-left corner. YouTube/Vimeo embeds (iframes) and native `<video>` (double-click = fullscreen) couldn't be selected or edited by click, so every image/audio/video block now has **Edit** and **Remove** buttons under it (hidden in read-only; never part of `getJSON`/`getHTML`).
- BREW: link, media and formula dialogs opened at the editor's top-left corner; they now appear just below the element or selection they edit, clamped inside the editor.
- BREW: captions under image/audio/video are editable inline again (click and type; Enter commits), with a placeholder when empty; they lock in read-only mode.
- BREW: table control buttons and KaTeX markup were stripped from editor-generated snippets (toolbar-inserted tables/formulas); they are now sanitized with the right allowances.
- Columns content was silently dropped when a BRE document was loaded into BREW or BREM (data shape `columns` vs `children`); both shapes are now read.
- `<style>`, `<form>`, `<input>`, `<button>` and friends are stripped from all sanitized content.
- `getHTML()` no longer caches the plain-text formula fallback while KaTeX is still loading (BRE and BREW).
- BREW formulas keep their KaTeX markup (SVG, layout styles) on `setJSON`.
- A user-registered `paste` transform no longer disables the built-in HTML paste.
- Malformed nested data no longer crashes the load: unknown types inside columns, non-array table rows, missing ids/data are normalized recursively.
- Drag reorder in virtualized mode dropped blocks at the wrong index and blanked the viewport; moves, undo and keyboard moves now keep the scroll window.
- Undo/redo: focus stays in the editor after structural undo; no-op key presses no longer push empty undo entries or wipe the redo stack; restored raw HTML is re-sanitized lazily.
- Inline code mark (`Cmd+/`, `<>` button) now updates the model, fires `change` and is undoable.
- Cmd+B/I/U no longer apply native formatting in blocks that don't support the mark (and table cells).
- Slash menu: Enter/Tab with no results closes the menu instead of getting stuck.
- Enter replaces a selection instead of moving it to the next block; Enter in a list continues the list and an empty item exits it.
- Custom blocks inside columns persist their data; dropping a non-image file no longer navigates away.
- `embedAllowlist` is honored by BREM and BREW (preview and `getHTML`); YouTube `/embed/`, `/shorts/`, `/live/`, `m.youtube.com` URLs embed correctly.
- BREW: typing on an empty first line is wrapped in a paragraph so block-type controls work.
- `require('bestricheditor')` works: the CommonJS/UMD build is emitted as `dist/bre.umd.cjs` (the package is `"type":"module"`).
- KaTeX output is passed through the sanitizer before insertion.
- RTL: drag handle sits on the correct side.
- The production bundle no longer drops block registration (`sideEffects` flag).
- **BRE → BREM `setJSON` silently produced an empty document** (data loss). Block documents are now converted to Markdown; BREM/BREW/BRE all accept each other's documents.
- Multiple editors on a page no longer share one video-embed allowlist (it now flows per instance).
- Default `getHTML()` no longer strips video embeds and formula markup.
- `style` attributes are stripped from sanitized content; for KaTeX output only an allowlist of layout properties with numeric values is kept (no `url()` / `expression()` / escape smuggling).
- Heading `level` from document data is clamped to 1–6 (a crafted level could previously inject markup into `getHTML()`).
- Numbered lists restart correctly after non-list blocks.

### Changed
- **Styling**: `bre.css` now includes a default look for the editor's OWN UI (menus, popups, dialogs, buttons, selection outline, table/media controls, drag-handle gutter), driven by `--bre-accent`, `--bre-accent-text`, `--bre-surface`, `--bre-border`, `--bre-radius`, `--bre-shadow`, `--bre-pad`, `--bre-focus`, `--bre-gutter`, `--bre-min-height`. Defaults use system colors (black buttons/white text on light pages, inverted on dark). Rules are plain single-class selectors so CSS resets (`* { padding: 0 }`, Tailwind preflight) cannot wipe the menu/button spacing, while a host rule for the same class still overrides them; only the variable defaults are zero-specificity. Content (text, headings, lists, quotes, code) is still never styled. For structure only, import `bestricheditor/base.css` (`dist/bre-base.css`, 1.5 kB gz). This replaces the earlier "no visual styling at all" policy.
- **BRE input dialogs**: URL, link and formula entry use the same inline dialog as BREW (shared `src/ui/dialog.js`) instead of the browser's `window.prompt` — positioned at the block, validated inline (`aria-invalid`), keyboard friendly (Enter/Esc), and styleable. `options.prompt` still overrides it.
- **Performance (BRE)**: structural-sharing state (O(1) undo snapshots, O(1) block lookup), no sanitizing on the keystroke path (lazy, per touched block), per-block HTML cache for `getHTML()`, one shared drag handle (2 elements per block instead of ~12), plain-text fast path (no DOMPurify for markup-free text), identity-based diff on undo/redo.
- **BREM**: block→Markdown conversion has a DOM-free fast path for simple inline markup and the preview is built from a single sanitized fragment (5,000-block `setJSON`: ~2.6 s → ~0.4 s in jsdom).
- **BREW**: incremental block model; `getJSON` / `getHTML` no longer re-walk the DOM.
- **Styling policy**: the stylesheet is now structural-only (no colors, fonts, sizes, spacing, radii, shadows or variables); everything inherits from the host. Floating UI uses system colors (`Canvas`, `CanvasText`, `Highlight`) so it is legible on any page.
- IDs use Web Crypto (64 bits) instead of `Math.random().slice(2, 10)`.
- KaTeX loads only when a formula is first needed (previously at import time).
- ESM size limit is 34 kB gz (was 32): three modes, converters, paste cleaning and upload now ship.
- All production builds (ESM, UMD) are minified with terser.
- `dist/` is cleaned before every build (stale KaTeX chunks no longer accumulate in the package).
- ESM build keeps `dompurify` and `katex` external so consumer bundlers can dedupe them; KaTeX is loaded via dynamic `import('katex')`.
- UMD build no longer inlines KaTeX (core UMD ~30 kB gzip, down from ~206 kB).
- KaTeX CSS is no longer injected from jsDelivr by default.
- `package.json`: `exports` map (types/import/require/css), `sideEffects: ["**/*.css"]`, `files`, `engines`.
- README: documents new options, events, sizes, CSP, and the "no visual opinions" styling policy.

### Removed
- Theming CSS variable documentation (`--bre-color-*`); the library inherits styling from the host.
