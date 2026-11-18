/**
 * Parse an HTML string into an array of BRE blocks (paste / setHTML pipeline).
 *
 * The input is sanitized ONCE by DOMPurify into a DOM fragment; every block's
 * inline html is then read from already-clean nodes (no per-block re-sanitize).
 */
import DOMPurify from 'dompurify';
import { generateId } from './id.js';
import { sanitizeURL, FORBIDDEN_TAGS } from './sanitize.js';
import { blockRegistry } from '../core/blockRegistry.js';

const BLOCK_SELECTOR =
  'p,div,h1,h2,h3,h4,h5,h6,ul,ol,li,table,pre,blockquote,hr,figure,section,article';
const CONTAINER_TAGS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'BODY',
  'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'FONT', 'A', 'CENTER', 'DETAILS', 'SUMMARY',
]);
const INLINE_TAGS = new Set([
  'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'INS', 'SUB', 'SUP', 'A',
  'CODE', 'MARK', 'SMALL', 'FONT', 'BR', 'ABBR', 'CITE', 'KBD', 'Q',
]);

function makeBlock(type, data) {
  return { id: generateId(), type, data };
}

/**
 * @param {string} html
 * @returns {Array<{id: string, type: string, data: object}>}
 */
export function htmlToBlocks(html) {
  if (typeof html !== 'string' || !html.trim()) return [];

  const frag = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_ATTR: ['style'],
    FORBID_TAGS: FORBIDDEN_TAGS,
    RETURN_DOM_FRAGMENT: true,
  });

  const blocks = [];
  walkChildren(frag, blocks);
  return blocks;
}

function hasBlockChild(el) {
  return !!el.querySelector(BLOCK_SELECTOR);
}

/** Serialize an inline run of nodes to an html string. */
function runToHTML(nodes) {
  const tmp = document.createElement('div');
  for (const n of nodes) tmp.appendChild(n);
  return { html: tmp.innerHTML, text: tmp.textContent };
}

function walkChildren(parent, blocks) {
  let run = [];

  const flush = () => {
    if (run.length === 0) return;
    const { html, text } = runToHTML(run);
    run = [];
    if (text.trim()) blocks.push(makeBlock('paragraph', { html: html.trim() }));
  };

  // Snapshot: we move nodes while iterating.
  const children = Array.from(parent.childNodes);
  for (const node of children) {
    if (node.nodeType === Node.TEXT_NODE) {
      run.push(node);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = node.tagName.toUpperCase();

    // Custom block hook (before built-ins so apps can claim elements).
    const custom = matchCustom(node);
    if (custom) {
      flush();
      blocks.push(custom);
      continue;
    }

    if (tag === 'BR') {
      run.push(node);
      continue;
    }

    if (CONTAINER_TAGS.has(tag)) {
      if (hasBlockChild(node)) {
        flush();
        walkChildren(node, blocks); // unwrap Google-Docs-style wrappers
      } else if (INLINE_TAGS.has(tag)) {
        run.push(node);
      } else if (node.textContent.trim()) {
        flush();
        blocks.push(makeBlock('paragraph', { html: node.innerHTML.trim() }));
      }
      continue;
    }

    if (INLINE_TAGS.has(tag) || tag === 'CODE') {
      run.push(node);
      continue;
    }

    flush();
    processBlockNode(node, tag, blocks);
  }
  flush();
}

function matchCustom(node) {
  const customs = blockRegistry.customs();
  for (let i = 0; i < customs.length; i++) {
    const def = customs[i].def;
    if (typeof def.fromHTML !== 'function') continue;
    let data = null;
    try { data = def.fromHTML(node); } catch (_) { data = null; }
    if (data) return makeBlock(def.type, data);
  }
  return null;
}

/** Inline html of a <li>, excluding nested lists; nested lists returned separately. */
function splitListItem(li) {
  const inline = [];
  const nested = [];
  for (const child of Array.from(li.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const t = child.tagName.toUpperCase();
      if (t === 'UL' || t === 'OL') { nested.push(child); continue; }
      if (t === 'P' || t === 'DIV') {
        // Unwrap paragraph-in-li (Google Docs / Word), keep inline content.
        inline.push(...Array.from(child.childNodes));
        continue;
      }
    }
    inline.push(child);
  }
  const { html, text } = runToHTML(inline);
  return { html: html.trim(), text, nested };
}

function listToBlocks(listEl, type, blocks) {
  for (const child of Array.from(listEl.children)) {
    if (child.tagName.toUpperCase() !== 'LI') continue;
    const { html, text, nested } = splitListItem(child);
    if (text.trim()) blocks.push(makeBlock(type, { html }));
    // The block model has no nesting: nested items are flattened in order.
    for (const n of nested) {
      listToBlocks(n, n.tagName.toUpperCase() === 'OL' ? 'numbered_list' : 'bulleted_list', blocks);
    }
  }
}

function processBlockNode(node, tag, blocks) {
  switch (tag) {
    case 'P': {
      if (node.textContent.trim()) {
        blocks.push(makeBlock('paragraph', { html: node.innerHTML.trim() }));
      }
      break;
    }

    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      if (node.textContent.trim()) {
        blocks.push(makeBlock('heading', { level: Number(tag[1]), html: node.innerHTML.trim() }));
      }
      break;
    }

    case 'BLOCKQUOTE': {
      if (node.textContent.trim()) {
        // Unwrap <p> children so quote text isn't double-wrapped.
        const inner = node.querySelector('p') && !node.querySelector('p ~ p')
          ? node.querySelector('p').innerHTML
          : node.innerHTML;
        blocks.push(makeBlock('quote', { html: inner.trim() }));
      }
      break;
    }

    case 'PRE': {
      const codeEl = node.querySelector('code');
      const code = (codeEl || node).textContent;
      const cls = (codeEl && codeEl.getAttribute('class')) || node.getAttribute('class') || '';
      const m = /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(cls);
      blocks.push(makeBlock('code', { code, language: m ? m[1] : '' }));
      break;
    }

    case 'UL':
      listToBlocks(node, 'bulleted_list', blocks);
      break;

    case 'OL':
      listToBlocks(node, 'numbered_list', blocks);
      break;

    case 'LI': {
      // Stray <li> outside a list.
      const { html, text } = splitListItem(node);
      if (text.trim()) blocks.push(makeBlock('bulleted_list', { html }));
      break;
    }

    case 'HR':
      blocks.push(makeBlock('divider', {}));
      break;

    case 'TABLE': {
      const rows = [];
      for (const tr of node.querySelectorAll('tr')) {
        const row = [];
        for (const cell of tr.children) {
          const t = cell.tagName.toUpperCase();
          if (t === 'TH' || t === 'TD') row.push(cell.textContent.trim());
        }
        if (row.length > 0) rows.push(row);
      }
      if (rows.length > 0) {
        // Normalise ragged rows so the table block is rectangular.
        const width = Math.max(...rows.map(r => r.length));
        for (const r of rows) while (r.length < width) r.push('');
        blocks.push(makeBlock('table', { rows }));
      }
      break;
    }

    case 'IMG': {
      const src = sanitizeURL(node.getAttribute('src') || '');
      if (src) {
        blocks.push(makeBlock('image', { src, alt: node.getAttribute('alt') || '', caption: '' }));
      }
      break;
    }

    case 'FIGURE': {
      const img = node.querySelector('img');
      const audio = node.querySelector('audio');
      const video = node.querySelector('video');
      const captionEl = node.querySelector('figcaption');
      const caption = captionEl ? captionEl.textContent.trim() : '';
      if (img) {
        const src = sanitizeURL(img.getAttribute('src') || '');
        if (src) blocks.push(makeBlock('image', { src, alt: img.getAttribute('alt') || '', caption }));
      } else if (audio) {
        const src = sanitizeURL(audio.getAttribute('src') || '');
        if (src) blocks.push(makeBlock('audio', { src, caption }));
      } else if (video) {
        const src = sanitizeURL(video.getAttribute('src') || '');
        if (src) blocks.push(makeBlock('video', { src, caption }));
      }
      break;
    }

    default:
      // Unknown element: keep its text rather than silently dropping it.
      if (node.textContent.trim()) {
        blocks.push(makeBlock('paragraph', { html: node.innerHTML.trim() }));
      }
      break;
  }
}
