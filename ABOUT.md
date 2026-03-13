Name: Best Rich Editor

Logo: ▦|

Primary Color: #111827

You are a senior frontend architect (25+ years) specializing in browser-based editors and performance. Build a complete, runnable open source codebase for a Notion-like rich editor written in Native JavaScript (ES2020+ ES Modules) and Vanilla DOM (no frameworks). The project must be:

- An npm-installable library that works in plain HTML and can be wrapped by Angular/React/Vue.

Non-negotiables

- No TypeScript
- No UI frameworks
- No heavy dependencies (keep minimal for size/perf)
- Use Rollup for build
- Use plain CSS with CSS variables for theming
- Namespace everything with bre:
  - JS exported API: bre.\*
  - CSS classes: .bre-\*
  - DOM attributes: data-bre-\*

# Deliverables

Provide:

- Full repo structure + all files
- Setup instructions (npm install, npm run dev, npm run build)
- Demo page showing “Best Rich Editor” in the top-left header, and an editor pre-filled with example content demonstrating every implemented block type and features.

# Public API (must be stable)

Library exports:

- createEditor(container, options) -> editorEditor instance methods:
- editor.getJSON()
- editor.setJSON(json)
- editor.getHTML()
- editor.destroy()

# Core architecture requirements

Design for extensibility and speed:

- Block-based document model (below)
- Block registry / plugin system: each block type implements
  - render(block, ctx)
  - toHTML(block)
  - fromHTML(domNode) (best-effort)
  - validate(block)
- Efficient updates: update only changed block(s), not full rerender
- Keyboard navigation between blocks, block split/merge, basic undo/redo
- Debounced autosave hook (no backend; just event + localStorage example)
- Smooth handling for 500 blocks with basic optimizations (document fragments, minimal DOM churn, event delegation)

# Data model (use exactly this)

```
Document = {
  id: string,
  version: number,
  created: number,
  updated: number,
  blocks: Block[]
}
```

```
Block = {
  id: string,
  type: string,
  data: object,
  children?: Block[]
}
```

# Security requirements

- All HTML output and any pasted HTML must be sanitized with DOMPurify
- Embeds must enforce an allowlist of domains and use safe iframe attributes:
  - sandbox, referrerpolicy, loading="lazy", no allow unless needed
- Prevent XSS via block data and attributes (escape text, sanitize URLs)

# KaTeX

- Use KaTeX for formula rendering (inline + block)
- Store formulas in block data (LaTeX string), render safely

# Modes (configurable)

The editor supports 3 modes via options.mode:

1. BREM (Markdown)

- Uses a textarea with auto-growing height
- A floating top-right button toggles Preview/Edit
- Preview is shown when textarea blurs OR user clicks Preview
- Clicking preview area or Edit toggles back to textarea
- Markdown preview must be sanitized
- Markdown supports headings, lists, code fences, quotes, divider, inline code, links, and KaTeX (if present)

2. BREW (WYSIWYG)

- Contenteditable-based surface with toolbar (TinyMCE/Froala-like)
- Buttons for: headings, bold/italic/underline, lists, quote, code, divider, link, formula, table, image, audio, video
- Output still maps to the block model internally

3. BRE (Default Notion-like)

- Block-based editor with:
  _ Slash menu to insert blocks
  _ Drag reorder blocks
  _ Columns layout (2-3 columns on desktop, stack on mobile)
  _ Block handles and hover affordances

# Block types (implement progressively; see “stages”)

- Paragraph/Text
- Headings (1 – 6)
- Bulleted list
- Numbered list
- Quote
- Divider
- Code
- Formula (KaTeX)
- Table
- Image
- Audio
- Video

# Quality bar

- Clean folder structure
- Readable code, comments where needed
- No global leaks; everything under bre
- Provide examples of integration in:
  - plain HTML (script module)
  - Angular wrapper example (minimal)
  - React wrapper example (minimal)

# Final output format

Return:

1. Repo tree
2. Key files content (all files required to run)
3. Brief setup + usage docs
