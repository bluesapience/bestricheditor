import { createEditor } from '/dist/bre.esm.js';

// ── BRE sample document ───────────────────────────────────────────────────────

const BRE_DOC = {
  id: 'demo-doc',
  version: 1,
  created: Date.now(),
  updated: Date.now(),
  blocks: [
    {
      id: 'b1',
      type: 'heading',
      data: { level: 1, text: 'Best Rich Editor' },
    },
    {
      id: 'b2',
      type: 'paragraph',
      data: {
        text: 'A Notion-like block editor built with Native JavaScript — no TypeScript, no frameworks. Try typing, pressing Enter to split blocks, Backspace to merge, or / to open the block menu.',
      },
    },
    {
      id: 'b3',
      type: 'heading',
      data: { level: 2, text: 'Text Blocks' },
    },
    {
      id: 'b4',
      type: 'paragraph',
      data: {
        text: 'This is a paragraph block. Click to edit. Press Enter to create a new block below.',
      },
    },
    {
      id: 'b5',
      type: 'heading',
      data: { level: 2, text: 'Lists' },
    },
    {
      id: 'b6',
      type: 'bulleted_list',
      data: { text: 'First bulleted item' },
    },
    {
      id: 'b7',
      type: 'bulleted_list',
      data: { text: 'Second bulleted item' },
    },
    {
      id: 'b8',
      type: 'bulleted_list',
      data: { text: 'Third bulleted item' },
    },
    {
      id: 'b9',
      type: 'numbered_list',
      data: { text: 'First numbered item' },
    },
    {
      id: 'b10',
      type: 'numbered_list',
      data: { text: 'Second numbered item' },
    },
    {
      id: 'b11',
      type: 'numbered_list',
      data: { text: 'Third numbered item' },
    },
    {
      id: 'b12',
      type: 'heading',
      data: { level: 2, text: 'More Blocks' },
    },
    {
      id: 'b13',
      type: 'quote',
      data: { text: 'The best way to predict the future is to invent it. — Alan Kay' },
    },
    {
      id: 'b14',
      type: 'divider',
      data: {},
    },
    {
      id: 'b15',
      type: 'code',
      data: {
        language: 'javascript',
        code: 'const editor = createEditor(container, { mode: "BRE" });\neditor.setJSON(doc);\nconsole.log(editor.getHTML());',
      },
    },
    {
      id: 'b15b',
      type: 'heading',
      data: { level: 2, text: 'Formula (KaTeX)' },
    },
    {
      id: 'b15c',
      type: 'formula',
      data: { latex: 'E = mc^2', displayMode: true },
    },
    {
      id: 'b15d',
      type: 'formula',
      data: { latex: '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}', displayMode: true },
    },
    {
      id: 'b16',
      type: 'heading',
      data: { level: 2, text: 'Columns' },
    },
    {
      id: 'b17',
      type: 'columns',
      data: {
        columns: [
          [
            {
              id: 'col-1-p1',
              type: 'paragraph',
              data: { text: 'Left column content. Each column is independently editable.' },
            },
          ],
          [
            {
              id: 'col-2-p1',
              type: 'paragraph',
              data: { text: 'Right column content. Columns stack on mobile screens.' },
            },
          ],
        ],
      },
    },
  ],
};

// ── BREW sample document ───────────────────────────────────────────────────────

const BREW_DOC = {
  id: 'brew-demo',
  version: 1,
  created: Date.now(),
  updated: Date.now(),
  blocks: [
    {
      id: 'bw1',
      type: 'heading',
      data: { level: 1, text: 'BREW — WYSIWYG Mode' },
    },
    {
      id: 'bw2',
      type: 'paragraph',
      data: {
        text: 'This is a WYSIWYG contenteditable editor. Use the toolbar to format text, change block types, or insert elements.',
      },
    },
    {
      id: 'bw3',
      type: 'heading',
      data: { level: 2, text: 'Text Formatting' },
    },
    {
      id: 'bw4',
      type: 'paragraph',
      data: { text: 'Select text and use Bold (⌘B), Italic (⌘I), or Underline (⌘U) from the toolbar.' },
    },
    {
      id: 'bw5',
      type: 'quote',
      data: { text: 'The best way to predict the future is to invent it. — Alan Kay' },
    },
    {
      id: 'bw6',
      type: 'bulleted_list',
      data: { text: 'First bulleted item' },
    },
    {
      id: 'bw7',
      type: 'bulleted_list',
      data: { text: 'Second bulleted item' },
    },
    {
      id: 'bw8',
      type: 'numbered_list',
      data: { text: 'First numbered item' },
    },
    {
      id: 'bw9',
      type: 'numbered_list',
      data: { text: 'Second numbered item' },
    },
    {
      id: 'bw10',
      type: 'divider',
      data: {},
    },
    {
      id: 'bw11',
      type: 'code',
      data: {
        language: 'javascript',
        code: 'const editor = createEditor(container, { mode: "BREW" });\neditor.setJSON(doc);\nconsole.log(editor.getHTML());',
      },
    },
    {
      id: 'bw12',
      type: 'heading',
      data: { level: 2, text: 'Formula (KaTeX)' },
    },
    {
      id: 'bw13',
      type: 'formula',
      data: { latex: 'E = mc^2', displayMode: true },
    },
    {
      id: 'bw14',
      type: 'formula',
      data: { latex: '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}', displayMode: true },
    },
  ],
};

// ── BREM sample markdown ───────────────────────────────────────────────────────

const BREM_SAMPLE = `# BREM — Markdown Mode

Write **bold**, *italic*, or \`inline code\` with ease.

## Lists

- First bulleted item
- Second bulleted item with **bold text**
- Third item with _italic_

1. First numbered item
2. Second numbered item
3. Third numbered item

## Blockquote

> The best way to predict the future is to invent it. — Alan Kay

## Code

\`\`\`javascript
const editor = createEditor(container, { mode: 'BREM' });
editor.setJSON(doc);
console.log(editor.getHTML());
\`\`\`

---

## Math

Inline formula: $E = mc^2$ — Einstein's mass-energy equivalence.

Block formula:

$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$

## Links

Visit [Best Rich Editor on GitHub](https://github.com) for more information.
`;

// ── Editor state ──────────────────────────────────────────────────────────────

const container = document.getElementById('bre-demo');
let editor = createEditor(container, { mode: 'BRE' });
editor.setJSON(BRE_DOC);
window.__bre = editor;

// ── Export toolbar ────────────────────────────────────────────────────────────

const card = document.querySelector('.demo-card');
if (card) {
  const toolbar = document.createElement('div');
  toolbar.className = 'demo-toolbar';
  toolbar.style.cssText = 'display:flex;gap:8px;padding:12px 24px;border-top:1px solid #e5e7eb;margin-top:8px;';

  const btnJSON = document.createElement('button');
  btnJSON.textContent = 'Export JSON';
  btnJSON.style.cssText = 'padding:6px 14px;border:1px solid #3b82f6;background:#eff6ff;color:#1d4ed8;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;';
  btnJSON.addEventListener('click', () => {
    const json = JSON.stringify(editor.getJSON(), null, 2);
    console.log('[BRE] getJSON():', json);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bre-document.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  const btnHTML = document.createElement('button');
  btnHTML.textContent = 'Export HTML';
  btnHTML.style.cssText = 'padding:6px 14px;border:1px solid #10b981;background:#ecfdf5;color:#065f46;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;';
  btnHTML.addEventListener('click', () => {
    const html = editor.getHTML();
    console.log('[BRE] getHTML():', html);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bre-document.html';
    a.click();
    URL.revokeObjectURL(url);
  });

  toolbar.appendChild(btnJSON);
  toolbar.appendChild(btnHTML);
  card.appendChild(toolbar);
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.demo-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const mode = tab.getAttribute('data-mode');

    // Update active tab styling
    document.querySelectorAll('.demo-tab').forEach(t => t.classList.remove('demo-tab--active'));
    tab.classList.add('demo-tab--active');

    // Destroy old editor
    editor.destroy();

    // Create new editor
    editor = createEditor(container, { mode });
    window.__bre = editor;

    // Populate with sample content
    if (mode === 'BREM') {
      editor.setJSON({
        id: 'brem-demo',
        version: 1,
        created: Date.now(),
        updated: Date.now(),
        blocks: [
          {
            id: 'md-1',
            type: 'markdown',
            data: { markdown: BREM_SAMPLE },
          },
        ],
      });
    } else if (mode === 'BREW') {
      editor.setJSON(BREW_DOC);
    } else {
      editor.setJSON(BRE_DOC);
    }
  });
});
