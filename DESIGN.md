# Best Rich Editor — Design Decisions

Internal design specs for planned and in-progress features.

---

## Inline Floating Toolbar (BRE mode)

**Date:** 2026-06-27  
**Status:** Approved, pending implementation

### Problem

Users have no way to discover inline formatting in BRE mode. The only affordance is a hidden keyboard shortcut (Cmd+K for links). Bold, italic, underline, and inline code have no shortcuts or UI at all.

### Solution

A floating toolbar that appears above (or below) selected text, showing only the formatting buttons supported by the current block type. Paired with keyboard shortcuts for all formatting marks.

### Architecture

A new `src/ui/inlineToolbar.js` module exports `createInlineToolbar(root, opts)` and returns `{ destroy }` — same shape as `createSlashMenu` and `initDragHandles`. Wired into `editor.js` at editor init, torn down in `destroy()`.

The toolbar is a single `div.bre-inline-toolbar` appended to `document.body` with `position: fixed` and a high z-index. Keeping it on `body` avoids overflow/stacking-context issues from the editor container.

**Lifecycle:**
- `selectionchange` + `mouseup` → check if selection is non-collapsed and anchored inside the editor root → show toolbar
- `mousedown` on a toolbar button → `preventDefault()` to preserve the selection → execute command → re-evaluate active states
- Collapsed selection, click outside editor, or `Escape` → hide toolbar
- `scroll` (`{ passive: true }`) → hide immediately (rect is stale after scroll)

### Context-Aware Buttons

The toolbar reads the focused block's type, looks up `capabilities` from `blockRegistry`, and renders only what's supported:

| Capability | Button | Command | Keyboard Shortcut |
|---|---|---|---|
| `bold` | **B** | `execCommand('bold')` | Cmd+B |
| `italic` | *I* | `execCommand('italic')` | Cmd+I |
| `underline` | U̲ | `execCommand('underline')` | Cmd+U |
| `code` | `<>` | custom Range wrap/unwrap in `<code>` | Cmd+/ |
| `links: true` | 🔗 | existing `handleLinkInsert()` | Cmd+K (already exists) |

Blocks and their supported marks:
- `paragraph`: bold, italic, underline, code, link
- `heading`: bold, italic
- `quote`, `bulleted_list`, `numbered_list`: bold, italic

**Active state:**
- Native marks: `document.queryCommandState('bold' | 'italic' | 'underline')`
- Inline code: check if selection's `commonAncestorContainer` is inside a `<code>` element
- Active buttons get a filled/tinted background

### Positioning

Uses `position: fixed` — no scroll offset arithmetic needed.

1. `rect = selection.getRangeAt(0).getBoundingClientRect()`
2. **Above (default):** `top = rect.top - toolbarHeight - 8`
3. **Flip below:** if `top < 8`, use `top = rect.bottom + 8`
4. **Horizontal:** `left = rect.left + rect.width/2 - toolbarWidth/2`, clamped within editor left/right bounds

### Visual Design

Matches existing slash menu aesthetic — same CSS variable palette from `bre.css`.

```
[ B ] [ I ] [ U ] [ | ] [ <> ] [ | ] [ 🔗 ]
```

- Background via `--bre-bg` / `--bre-border` vars, subtle box-shadow, `border-radius: 6px`
- Buttons: `32×32px` with hover highlight
- Thin `|` dividers separate mark groups from link button
- Active mark: filled/tinted background
- Entry: `opacity 0→1` fade-in (`100ms`)

### Files to Change

| File | Change |
|---|---|
| `src/ui/inlineToolbar.js` | New — full toolbar module |
| `src/bre.css` | New `.bre-inline-toolbar` styles |
| `src/core/editor.js` | Wire in `createInlineToolbar`; add Cmd+B/I/U/`/` to keydown handler |
