# Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drop, paste or pick image files in BRE, BREW and BREM, uploaded through the host's `uploadImage` function and placed at the cursor, with README recipes for Firebase Storage, S3 and a generic endpoint.

**Architecture:** One small shared module (`src/utils/imageUpload.js`) holds validation, the upload call + URL sanitizing, the file picker and the drag-over marker. Each mode keeps its own placement logic: BRE inserts blocks, BREW inserts a placeholder element then an image figure, BREM inserts a Markdown placeholder in the textarea then swaps it. Core stays function-only; no adapters, no new dependencies.

**Tech Stack:** Native JS ES modules, jsdom tests via `node scripts/run-tests.mjs`, DOMPurify (existing).

**Spec:** `docs/superpowers/specs/2026-11-24-image-upload-design.md`

## Global Constraints

- Plain ES2020+ JS, no TypeScript, no new runtime dependencies (DOMPurify and KaTeX only).
- Names are `bre`-prefixed: `data-bre-*`, `.bre-*`.
- Public signature unchanged: `uploadImage(file: File) => Promise<string>`. New optional `uploadMaxSize?: number` (bytes).
- The returned URL always goes through `sanitizeURL`; never `data:` / `blob:` URLs; never read files with `FileReader` for this.
- Upload only when `file.type` starts with `image/`. Other dropped files: `preventDefault()` and ignore.
- No hook configured: image files are ignored (`preventDefault()`) and an `error` event `{ type: 'upload', error, file }` is emitted; URL dialogs unchanged.
- **One image per action:** a drop, paste or pick uploads only the first image file; if more were supplied, emit exactly one `error` event for the action (`Error(messages.uploadOneAtATime)`, `file` = first ignored file) and ignore them. The picker is single-select (no `multiple`). Separate actions may overlap.
- Failures (rejected promise, sync throw, non-string result, unsafe URL, oversize) → `error` event `{ type: 'upload', error, file }`, announce `uploadFailed`, placeholder removed.
- After `destroy()` and in read-only mode, nothing is inserted and nothing throws.
- Content is never styled; only an attribute plus a neutral outline in `src/bre.theme.css`. `src/bre.base.css` stays structural.
- Core UMD budget is 53 kB (currently 52.13 kB). Report growth; do not change budgets without the owner.
- **The owner said: do not commit.** Leave all changes in the working tree; there are no commit steps in this plan.

## Review Focus

1. Several image files in one action: only the first uploads and exactly one error is emitted; two separate drops of same-named files into BREM get distinct placeholders and each result lands in its own place (tasks 2, 3, 4).
2. BREM placeholder edited or deleted by the user before the upload resolves: result is discarded, text is not corrupted, no throw (task 3).
3. File names with `]`, `)`, `(`, spaces, unicode, emoji or very long names yield valid Markdown in BREM (task 3).
4. `destroy()` or `setJSON()` while an upload is pending, in each mode: no throw, no stale insertion (tasks 2, 3, 4).
5. Hook that throws synchronously, resolves `undefined`, or resolves a non-string: treated as a failure, not a crash (task 1).

---

### Task 1: Shared upload helpers

**Files:**
- Create: `src/utils/imageUpload.js`
- Modify: `src/utils/blocksToMarkdown.js` (export `encodeUrl`)
- Test: `tests/imageUpload.test.mjs`

**Interfaces:**
- Produces (all exported from `src/utils/imageUpload.js`):
  - `imageFiles(list: FileList | File[] | null | undefined): File[]` — only `image/*` files, in order.
  - `splitFirst(files: File[]): { first: File | null, extra: File[] }` — the first file and the rest (`first` is `null` for an empty list).
  - `async uploadOne(file: File, cfg: { hook: unknown, maxSize?: number, messages: { uploadNotConfigured: string, uploadTooLarge: string, invalidUrl: string, uploadFailed: string, uploadOneAtATime: string } }): Promise<string>` — resolves the sanitized URL, otherwise throws `Error` (message from `messages`).
  - `altFromFile(file: File): string` — file name without its final extension.
  - `pickImageFiles(parent: Element): Promise<File[]>` — hidden single-select `<input type=file accept="image/*">` appended to `parent`, resolves on `change`/`cancel`, removes the input.
  - `trackFileDrag(root: Element, isEnabled: () => boolean): () => void` — sets `data-bre-dragover="true"` on `root` while files are dragged over it (`dragenter`/`dragover`), removes it on `dragleave` (leaving the root), `drop`, and disposal; returns the disposer.
  - `markdownImage(alt: string, url: string): string` — `![alt](url)`, alt has `\`, `[`, `]` escaped, url encoded with `encodeUrl`.
- Consumes: `sanitizeURL` from `src/utils/sanitize.js`; `encodeUrl` from `src/utils/blocksToMarkdown.js`.

- [ ] **Step 1: Write the failing tests** in `tests/imageUpload.test.mjs` (import `./env.mjs` for the jsdom globals like the other tests):
  - `imageFiles` keeps `image/png` and `image/jpeg`, drops `text/plain`, accepts `null`.
  - `splitFirst([a, b, c])` → `{ first: a, extra: [b, c] }`; `splitFirst([])` → `{ first: null, extra: [] }`.
  - `pickImageFiles` creates an input without the `multiple` attribute.
  - `uploadOne` resolves `'https://cdn.example.com/a.png'` for a hook returning it.
  - `uploadOne` rejects with `messages.uploadNotConfigured` when `hook` is `undefined`.
  - `uploadOne` rejects with `messages.uploadTooLarge` when `file.size > maxSize` and the hook is never called.
  - `uploadOne` rejects for hooks that: throw synchronously, resolve `undefined`, resolve `42`, resolve `'javascript:alert(1)'`, resolve `'data:image/png;base64,AAAA'` (message `messages.invalidUrl` for the last two).
  - `altFromFile` maps `'my.photo.png'` → `'my.photo'` and `'noext'` → `'noext'`.
  - `markdownImage('a]b', 'https://e.com/x y(1).png')` → `'![a\\]b](https://e.com/x%20y%281%29.png)'`.
  - `trackFileDrag`: a `dragenter` event whose `dataTransfer.types` includes `'Files'` sets the attribute; `dragleave`/`drop` clears it; with `isEnabled` returning false it never sets; the disposer stops reacting.
- [ ] **Step 2: Run** `node --test tests/imageUpload.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the module per the interfaces; `encodeUrl` becomes a named export of `blocksToMarkdown.js` with no behaviour change. `uploadOne` wraps the hook call in `async` so a synchronous throw becomes a rejection.
- [ ] **Step 4: Run** `node --test tests/imageUpload.test.mjs`, then `npm test`. Expected: all pass.

---

### Task 2: BRE — no-hook error, size cap, drop position, drag marker

**Files:**
- Modify: `src/core/editor.js` (`handleDrop` ~1422, `uploadImages` ~1488, `pickFiles` ~1468, paste image branch ~1363, slash picker ~671/1546, root listeners ~368)
- Modify: `src/core/messages.js` (add `uploadNotConfigured: 'Image upload is not configured'`, `uploadTooLarge: 'Image is too large'`, `uploadOneAtATime: 'Upload one image at a time'`)
- Test: `tests/bre.test.mjs`

**Interfaces:**
- Consumes: Task 1 exports. `opts.uploadMaxSize`.
- Produces: `uploadImages(files: File[], anchorId: string | null, replaceTarget: boolean, position?: 'before' | 'after')` (position defaults to `'after'`).

- [ ] **Step 1: Write failing tests** in `tests/bre.test.mjs`:
  - drop of a `image/png` file with **no** `uploadImage`: event `defaultPrevented`, `onError` receives `type: 'upload'`, document unchanged.
  - paste of an image file with no hook: same error, document unchanged.
  - `uploadMaxSize: 3` with a 5-byte file: hook not called, `onError` once, document unchanged.
  - drop onto a block with `getBoundingClientRect` stubbed to `{top: 0, height: 100}` and `clientY: 10` inserts the image block **before** it; `clientY: 90` inserts **after**.
  - `data-bre-dragover` is set on the editor root by a files `dragenter` and cleared by `drop`.
  - drop of three image files: the hook is called once with the first, and `onError` fires exactly once (`file` = the second).
  - `destroy()` while the hook promise is pending, then resolve: no throw, no `error` event.
  - `setJSON(...)` while pending, then resolve: no throw (anchor gone → inserted at the end, as today).
- [ ] **Step 2: Run** `node --test tests/bre.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Replace the local `pickFiles` with `pickImageFiles(root)`. Make `uploadImages` apply `splitFirst` (report extras once) and call `uploadOne` for the first file (hook may be absent: in that case emit the error without touching the document and `announce(messages.uploadFailed)`). In `handleDrop`, decide `'before'`/`'after'` from `e.clientY` against the target block's rect midpoint (`>=` midpoint → after); the existing empty-paragraph / unset-image replacement still wins. Register `trackFileDrag(root, () => !readOnly)` once and dispose it in `destroy()`. Keep announcing `messages.uploading` before each file.
- [ ] **Step 4: Run** `node --test tests/bre.test.mjs`, then `npm test`. Expected: all pass.

---

### Task 3: BREM — placeholders at the cursor

**Files:**
- Modify: `src/modes/brem.js` (messages ~14, event list ~35, textarea listeners ~148, root listeners)
- Test: `tests/modes.test.mjs` (append a `BREM image upload` section)

**Interfaces:**
- Consumes: Task 1 exports; `opts.uploadImage`, `opts.uploadMaxSize`, `opts.onError`.
- Produces: BREM now emits `'error'` (`{ type: 'upload', error, file }`) and accepts `onError`. New message keys on `DEFAULT_MESSAGES`: `uploadingFile: 'Uploading {name}…'`, `uploadFailed: 'Image upload failed'`, `uploadNotConfigured`, `uploadTooLarge`, `uploadOneAtATime`, `invalidUrl`.

- [ ] **Step 1: Write failing tests** (host: `createEditor(mount(), { mode: 'BREM', uploadImage })`; deliver files with `drop` and `paste` events carrying `dataTransfer.files` / `clipboardData.files` on the textarea; enter edit mode first):
  - drop at caret position 6 of `'hello world'` inserts `![Uploading pic.png…]()` at 6 immediately; after the hook resolves it becomes `![pic](https://cdn.example.com/pic.png)` in `textarea.value` and in `getJSON().blocks[0].data.markdown`; one `change` is emitted.
  - a selected range is replaced by the placeholder.
  - paste of an image file behaves the same; paste of plain text is untouched.
  - two separate drops of same-named files while the first is pending: two distinct placeholders (second gets a ` (2)` style suffix), and the results land in their own placeholders when resolved in reverse order.
  - one drop with three files: only the first is uploaded (one placeholder), and `onError` fires once with `file` = the second.
  - user deletes the placeholder before resolve: text unchanged, no error event.
  - user edits text around the placeholder before resolve: only the placeholder is replaced.
  - failure (reject, `undefined`, `'javascript:alert(1)'`, oversize): placeholder removed, one `error` event, text otherwise unchanged.
  - names `'a](b).png'`, `'my photo (1).png'`, `'日本語.png'`, a 300-character name: resulting Markdown parses back (`getHTML()`) to exactly one `<img>` with a `src` equal to the URL.
  - no hook: drop/paste of an image file is `defaultPrevented`, error event emitted, textarea unchanged.
  - dropping on the **preview** enters edit mode and appends the placeholder at the end on its own line.
  - `destroy()` while pending, then resolve: no throw; read-only: nothing happens.
  - `data-bre-dragover` toggles on the root.
- [ ] **Step 2: Run** `node --test tests/modes.test.mjs`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** in `brem.js`: `async function uploadFiles(files: File[]): Promise<void>` (takes `splitFirst` of the list, reports the extras once, uploads the first), `insertAtCaret(text: string): void` (uses `selectionStart/End`, updates `markdown`, `renderCache = null`, `scheduleChange()`, restores the caret), `replacePlaceholder(placeholder: string, next: string): void` (first exact match in `textarea.value`, otherwise no-op). Label uniqueness via a per-editor in-flight set. Wire `drop`/`dragover` on `root` and `paste` on the textarea; add `'error'` to the emitter list; dispose `trackFileDrag` in `destroy()`; ignore results when `destroyed`.
- [ ] **Step 4: Run** `node --test tests/modes.test.mjs`, then `npm test`. Expected: all pass.

---

### Task 4: BREW — toolbar picker, drop and paste at the caret

**Files:**
- Modify: `src/modes/brew.js` (messages ~49, emitter events ~244, image toolbar loop ~1111, paste handler ~1428, serializer for blocks)
- Test: `tests/modes.test.mjs` (append a `BREW image upload` section)

**Interfaces:**
- Consumes: Task 1 exports; `insertMediaBlock`/`snippetFor` helpers already in `brew.js`.
- Produces: BREW emits `'error'`/`onError`; new message keys as in task 3 plus `uploading: 'Uploading image…'`. Placeholder markup: `<p data-bre-upload="ID" contenteditable="false" class="bre-upload-placeholder">Uploading image…</p>`.

- [ ] **Step 1: Write failing tests:**
  - with a hook, `mousedown` on the toolbar image button calls the picker (stub `pickImageFiles` via a `change` event on the hidden input) and the chosen file ends up as an `image` block at the saved caret; without a hook the URL dialog still opens.
  - drop of an image file: a placeholder appears at once; after resolve `getJSON().blocks` contains an `image` block with the URL and `alt` = file name without extension, followed by a paragraph.
  - **while pending**, `getJSON()` and `getHTML()` contain no placeholder text, and a `change` event does not include it.
  - paste of an image file inserts at the current selection; paste of HTML/text is unchanged.
  - failure variants (reject, `undefined`, unsafe URL, oversize): placeholder removed, one `error` event.
  - placeholder removed by the user before resolve: result discarded, no throw.
  - no hook: drop/paste image file `defaultPrevented` + error event, document unchanged.
  - `destroy()` and `setJSON()` while pending: no throw, no stale insertion; read-only: ignored.
  - one drop with two files: only the first is inserted, `onError` fires once; the toolbar picker input has no `multiple` attribute.
- [ ] **Step 2: Run** `node --test tests/modes.test.mjs`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** `async function uploadFiles(files: File[], range: Range | null): Promise<void>` in `brew.js` (takes `splitFirst` of the list, reports the extras once, uploads the first); `caretRangeAt(x: number, y: number): Range | null` using `document.caretRangeFromPoint` then `caretPositionFromPoint`, falling back to the selection, then the end of the surface (jsdom has neither API). Insert the placeholder with a collapsed-range insert (not `execCommand`) so it works without focus; on success replace it with the node from `snippetToNode(snippetFor({ type: 'image', data: { src, alt, caption: '' } }, id))` plus the trailing-paragraph rule used by `insertMediaBlock`. The block serializer skips any element with `data-bre-upload`. Add `'error'` to the emitter list and the `uploadFailed` announce via the existing `announce()`.
- [ ] **Step 4: Run** `node --test tests/modes.test.mjs`, then `npm test`. Expected: all pass.

---

### Task 5: Documentation, types, theme outline

**Files:**
- Modify: `README.md` (new "Image upload" section; option table row for `uploadMaxSize`; `uploadImage` row updated to say all modes)
- Modify: `types/index.d.ts` (`uploadMaxSize?: number`; `uploadImage` doc comment: all modes; `Messages` keys if the type enumerates them)
- Modify: `CHANGELOG.md` (Unreleased entry)
- Modify: `src/bre.theme.css` (neutral outline for `.bre-editor[data-bre-dragover]` using `var(--bre-focus, Highlight)`)
- No automated test: the recipes are checked by syntax in step 3.

- [ ] **Step 1:** Write the README section covering: what enabling does per mode; behaviour with no hook; `uploadMaxSize`; `onError`; CORS and CSP `connect-src` notes; recipes — Firebase Storage with the SDK (`uploadBytes` + `getDownloadURL`), Firebase Storage over REST with `fetch` and optional ID token, S3 presigned `PUT` (browser asks the host server for `{ uploadUrl, url }`, with a short server-side presign example and a bucket CORS snippet, stating that signing cannot happen in the browser), generic multipart `POST` returning JSON `{ url }`. State plainly that `data:` URLs are never used.
- [ ] **Step 2:** Update types and CHANGELOG as listed; add the theme rule.
- [ ] **Step 3: Verify** each recipe is syntactically valid JS (extract the fences to a scratch `.mjs` and run `node --check`), and `npm run build` still succeeds. Expected: no syntax errors.

---

### Task 6: Verify

- [ ] **Step 1:** `npm test` — all tests pass, 0 failed.
- [ ] **Step 2:** `npm run build && npm run size` — report each size against its budget. If the UMD core exceeds 53 kB, stop and report the overage to the owner instead of changing the budget.
- [ ] **Step 3: Real browser pass.** Serve with `npm run preview`, open the demo, and in each mode with a fake `uploadImage` (a promise that resolves a `https://` URL after ~800 ms) check: BREM drop and paste at the cursor, placeholder then replacement, undo/redo not corrupted; BREW toolbar picker, drop at a caret placed mid-paragraph, caret afterwards; BRE slash picker and drop above/below. Check the same flows with the hook removed produce an `error` and no document change. Record what was and was not exercised.
