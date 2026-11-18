# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
- **BRE → BREM `setJSON` silently produced an empty document** (data loss). Block documents are now converted to Markdown; BREM/BREW/BRE all accept each other's documents.
- Multiple editors on a page no longer share one video-embed allowlist (it now flows per instance).
- Default `getHTML()` no longer strips video embeds and formula markup.
- `style` attributes are stripped from sanitized content (no `url()` / `expression()` smuggling).
- Numbered lists restart correctly after non-list blocks.

### Changed
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
