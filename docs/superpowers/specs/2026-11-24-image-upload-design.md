# Image upload in BRE, BREW and BREM — design

Status: draft for approval. Not committed (per the owner's instruction).

## Intent and why

Users should be able to put an image into a document by dropping, pasting or picking a file, in all three
editing modes, the way GitHub issues work: the image appears where the cursor is, with visible
"uploading" feedback, and ends up as a normal image in the document.

The library has no backend and must not embed files as `data:` URLs (security rule, out of the
question). So the **host application supplies the upload function**; the editor handles the
interaction, placement, feedback, validation and safety.

## What exists today (verified in the code)

- `options.uploadImage(file) => Promise<string>` is already part of the public API (types, README, CHANGELOG).
- **BRE** (`src/core/editor.js`): slash-menu "Image" opens a file picker when the hook is set; paste of image
  files uploads; drop uploads **after the block under the pointer** (not at the drop point). With no hook, dropped
  image files are swallowed silently. Failures emit the `error` event (`type: 'upload'`) and announce
  `messages.uploadFailed`. Results pass through `sanitizeURL`.
- **BREW** (`src/modes/brew.js`): the toolbar image button only opens the URL dialog. No file drop, no file paste
  (paste handler only reads `text/html` and `text/plain`). Media is inserted with `insertMediaBlock`.
- **BREM** (`src/modes/brem.js`): a `<textarea>` plus a preview. No file handling at all.
- i18n already has `uploading` and `uploadFailed`; `invalidUrl` exists.

## Goals

1. **One option enables everything:** `uploadImage` set ⇒ upload UI is active in all modes; not set ⇒ nothing changes
   for the user except that dropped/pasted image files fail visibly instead of silently.
2. **BREM:** dropping or pasting an image file, or pasting an image from the clipboard, inserts a placeholder at the
   textarea cursor — `![Uploading photo.png…]()` — which is replaced by `![photo](https://…)` when the upload
   resolves, and removed if it fails.
3. **BREW:** the toolbar image button opens a file picker (when the hook is set); dropping and pasting image files
   insert at the caret/drop point. A non-serialized placeholder shows while uploading.
4. **BRE:** slash-menu picker (exists) and paste (exists) are kept; drop is fixed to land at the drop point (above or
   below the block under the pointer, by pointer position).
5. Same rules in all modes: image types only, optional size cap, URL sanitized, errors reported through the existing
   `error` event, screen-reader announcements, safe after `destroy()`, disabled in read-only.
6. **Documentation:** README section "Image upload" with copy-paste recipes for Firebase Storage (SDK and REST),
   Amazon S3 (presigned URL), and a generic multipart endpoint, plus the host-side notes (CORS, CSP `connect-src`).

## Non-goals

- Built-in Firebase/S3 adapters or any SDK dependency (decided: **core stays function-only; adapters are documentation
  recipes**). A packaged `bestricheditor/uploaders` entry point is a possible later project.
- Embedding files as `data:`/`blob:` URLs, ever. Reading files with `FileReader` for this feature.
- Progress bars, cancel, resize/compress/EXIF handling, multi-file batches or queues (one file per action).
- Audio/video upload; non-image files; uploading images that arrive inside pasted HTML.
- A BREM toolbar/file-picker button (BREM has only the Preview/Edit toggle).
- Visual styling of content (project rule). Only an attribute hook and a neutral default outline for the editor's own UI.

## Anti-goals (a failure even if it "works")

- Any path that puts a file's bytes or a `data:`/`blob:`/`javascript:` URL into the document or the HTML output.
- A placeholder or half-finished upload leaking into `getJSON()` / `getHTML()` / the change event.
- A late upload result writing into an editor that was destroyed, or into text the user has since deleted.
- Growing the core UMD bundle beyond its budget by more than a small amount (budget is 53 kB; currently 52.13 kB).

## Constraints

- Plain ES2020+ JS, no new dependencies, `bre`-prefixed names (`data-bre-*`, `.bre-*`).
- Sanitization rules unchanged: result URL goes through `sanitizeURL`; DOMPurify for any HTML insertion.
- Existing public signature stays: `uploadImage(file: File) => Promise<string>`.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Function-only core; Firebase/S3/endpoint as documented recipes | No new bytes or surface; each user copies a few lines |
| B | `upload: { firebase \| s3 \| endpoint }` config object in core | Convenient, but adapters ship in every bundle, and the core is near its size budget |
| C | Adapters in an optional `bestricheditor/uploaders` entry | Small core and convenient, but a new build output, exports entry and size budget to maintain |

The owner picked A and asked for B/C-style examples in the documentation; those become the recipes above.

## Behaviour by mode (decisions)

### Shared

- An upload is attempted only for files whose `type` starts with `image/`. Other dropped files are ignored with
  `preventDefault()` (so the browser never navigates away), as today.
- **No hook:** image files are ignored the same way, and an `error` event is emitted
  (`{ type: 'upload', error: Error('uploadImage is not configured'), file }`). The toolbar image button (BREW) and slash
  "Image" (BRE) keep their URL dialogs.
- **Size cap:** optional `uploadMaxSize` (bytes). Larger files are rejected before calling the hook, with an `error`
  event and `messages.uploadFailed`. *(My call: added because every host needs it and it is one line.)*
- **One image per action (owner's rule).** A drop, paste or file pick uploads only the **first** image file. If more
  image files came with it, the extras are ignored and exactly one `error` event is emitted for that action
  (`Error('Upload one image at a time')`, `file` = the first ignored file, message key `uploadOneAtATime`). The file picker
  is single-select. A *later* action may start while an earlier upload is still running (separate actions are not
  blocked).
- A rejected promise, a non-string result, or a result that `sanitizeURL` rejects counts as a failure.
- After `destroy()`, a resolving upload is ignored. In read-only mode nothing is accepted.
- Announce start with `messages.uploading` and failure with `messages.uploadFailed` (BRE already does).

### BREM

- Works only on the textarea. Insert point is the caret/selection at the time of the drop or paste (the user said
  "at the cursor"; textareas have no reliable drop-point API). A selection is replaced.
- Dropping on the **preview** switches to edit mode and inserts at the end of the text, on its own line.
- Placeholder text: `![Uploading <name>…]()` where the label uses `messages.uploadingFile` and the file name; it must be
  **unique per in-flight upload** (add a counter on collision) so results from separate actions with the same file name
  map to the right placeholder.
- On success, find that exact placeholder in the textarea and replace it with `![<alt>](<url>)`, where alt is the file
  name without extension with Markdown-significant characters escaped and the URL is encoded the same way
  `blocksToMarkdown` encodes URLs (spaces and parentheses). Update `markdown`, keep the caret stable, invalidate the
  render cache, and schedule a normal `change`.
- If the placeholder is no longer in the text (user deleted it) the result is discarded without error.
- On failure remove the placeholder; emit `error`.
- The placeholder is real text in the textarea, so `getJSON()` mid-upload contains it. *(Accepted: this is how GitHub
  behaves and keeps BREM's "markdown is the document" model.)*
- Pasted image **files** are handled; pasted text/HTML keep current behaviour.

### BREW

- Toolbar image button: with the hook set, opens the single-select file picker instead of the URL dialog; without
  the hook, unchanged. URLs can still be set for existing images through the figure's edit dialog and by pasting.
  *(My call: the toolbar is the requested entry point; losing "insert by URL from the toolbar" when a host enables
  uploads is the trade-off. A later "Upload" button inside the dialog could restore both.)*
- Drop: place the caret at the drop point (`caretRangeFromPoint` / `caretPositionFromPoint`) and insert there. Paste:
  insert at the current selection. Picker: insert at the selection saved when the button was pressed.
- While uploading, insert a placeholder element marked `data-bre-upload="<id>"`,
  `contenteditable="false"`, text `messages.uploading`. It must be excluded from `getJSON()`, `getHTML()`,
  `setJSON` round-trips and the change event; the serializer skips it.
- On success replace the placeholder with the standard image figure (same snippet and sanitizer path as
  `insertMediaBlock`, plus the trailing paragraph rule so the caret can continue). If the placeholder was removed,
  discard. On failure remove it and emit `error`.

### BRE

- Slash menu "Image" and paste: unchanged. Drop: insert **before** the block when the pointer is in its upper half,
  **after** otherwise (today: always after). When the target is an empty paragraph or an unset image block it is
  replaced, as today.
- No placeholder block (current behaviour: announce, then insert on completion). If the anchor block was deleted
  meanwhile, insert at the end, as today.

### Drag-over affordance

While image files are dragged over the editor root, set `data-bre-dragover="true"` on it; remove on leave/drop.
`bre.base.css` stays structural; `bre.theme.css` may give it a neutral outline using existing variables.
*(My call; small.)*

## Documentation deliverables

README "Image upload" section covering:
- the option, what it enables, behaviour without it, errors (`onError`), `uploadMaxSize`, and the CSP/CORS notes;
- **Firebase Storage recipe (SDK):** `uploadBytes` + `getDownloadURL`;
- **Firebase Storage recipe (REST, no SDK):** `fetch` to the Storage REST endpoint with an optional ID token;
- **Amazon S3 recipe:** the browser asks the host's server for a presigned PUT URL, `PUT`s the file, returns the public
  URL; includes a short server-side presign example and a bucket CORS snippet; states plainly that signing cannot
  happen in the browser;
- **Generic endpoint recipe:** multipart `POST`, URL read from JSON.
Update `types/index.d.ts` (`uploadMaxSize`, error info for uploads) and `CHANGELOG.md`.

## Testing expectations

jsdom tests per mode (hook present, hook absent, failure, unsafe URL, oversize, non-image, destroy mid-upload,
read-only, several files in one action → only the first uploads plus one error), BREM placeholder replace/discard/collision, BREW placeholder never serialized,
BRE upper/lower-half drop. A real-browser pass for drop-point placement in BREW and caret behaviour in BREM.

## Left to the builder

Exact caret-at-point helper for BREW across browsers; where the shared upload orchestration lives (a small module
used by all three modes is expected, to avoid triplicating the validation); message key names for new strings;
whether the size cap needs a budget bump (keep growth small).
