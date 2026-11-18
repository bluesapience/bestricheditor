/**
 * BRE blocks -> markdown string (inverse of markdownToBlocks in markdown.js).
 *
 * Choices (documented, lossy spots warn once via console.warn):
 *  - inline marks: bold `**x**`, italic `*x*` (`_x_` when nested), strike `~~x~~`,
 *    code `` `x` ``, links `[t](u)`, underline kept as `<u>x</u>` (understood by
 *    the BREM parser), <br> kept as `<br>`.
 *  - audio/video blocks become `![caption](src)` (the BREM renderer picks
 *    <audio>/<video>/embed by URL, so they round-trip when the URL is recognisable).
 *  - image captions go in the markdown title: `![alt](src "caption")`.
 *  - columns are flattened in reading order (lossy, warns once).
 *  - nested `children` on non-column blocks are flattened (lossy, warns once).
 *  - table cells are plain text (BRE tables store strings).
 */
import { sanitizeHTML } from './sanitize.js';

const _warned = new Set();
function warnOnce(key, msg) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn('[bre] ' + msg);
}

/** Escape characters that would be read as inline markdown. */
function escText(s) {
  return s.replace(/[\\`*_[\]$~<]/g, '\\$&');
}

/** Prevent a line from being read as a block construct. */
function guardLineStart(s) {
  if (/^\d+\.\s/.test(s)) return s.replace('.', '\\.');
  if (/^(#{1,6}\s|[-+]\s|>|\|)/.test(s)) return '\\' + s;
  if (/^[-_]{3,}\s*$/.test(s)) return '\\' + s;
  return s;
}

function wrap(open, inner, close) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!m[2]) return inner;
  return m[1] + open + m[2] + close + m[3];
}

function encodeUrl(url) {
  return String(url).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

let _parser = null;

function nodeToMd(node, inStrong) {
  if (node.nodeType === 3) {
    return escText(node.nodeValue.replace(/ /g, ' ').replace(/[\r\n]+/g, ' '));
  }
  if (node.nodeType !== 1) return '';
  const tag = node.nodeName.toUpperCase();

  if (node.getAttribute('data-bre-type') === 'formula') {
    const latex = node.getAttribute('data-bre-latex');
    if (latex != null) return `$${latex}$`;
  }
  if (node.classList && node.classList.contains('katex')) {
    const ann = node.querySelector('annotation[encoding="application/x-tex"]');
    return ann ? `$${ann.textContent}$` : escText(node.textContent || '');
  }

  const kids = () => {
    let s = '';
    for (const c of node.childNodes) s += nodeToMd(c, inStrong);
    return s;
  };

  switch (tag) {
    case 'STRONG':
    case 'B': {
      let s = '';
      for (const c of node.childNodes) s += nodeToMd(c, true);
      return wrap('**', s, '**');
    }
    case 'EM':
    case 'I': {
      const inner = kids();
      const d = inStrong || /^\*|\*$/.test(inner.trim()) ? '_' : '*';
      return wrap(d, inner, d);
    }
    case 'U':
      return wrap('<u>', kids(), '</u>');
    case 'S':
    case 'DEL':
    case 'STRIKE':
      return wrap('~~', kids(), '~~');
    case 'CODE':
      return wrap('`', node.textContent || '', '`');
    case 'A': {
      const href = node.getAttribute('href');
      const inner = kids();
      if (!href) return inner;
      if (!inner.trim()) return '';
      return `[${inner}](${encodeUrl(href)})`;
    }
    case 'BR':
      return '<br>';
    case 'IMG': {
      const src = node.getAttribute('src');
      return src ? `![${escText(node.getAttribute('alt') || '')}](${encodeUrl(src)})` : '';
    }
    default:
      return kids();
  }
}

// ── DOM-free fast path ─────────────────────────────────────────────────────
// Handles the overwhelmingly common shape: attribute-free <strong>/<b>/<em>/
// <i>/<u>/<s>/<del>/<code> around plain text, no entities. Builds a tiny tree
// of node-like objects and reuses nodeToMd, so output is identical to the DOM
// path. Anything else (links, attributes, entities, unbalanced tags) returns
// null and takes the sanitizing DOMParser path.
const SIMPLE_TOKEN = /<(\/?)(strong|b|em|i|u|s|del|strike|code)>|([^<&]+)/gi;

function fakeEl(name) {
  const el = {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    childNodes: [],
    getAttribute: () => null,
    classList: null,
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el.childNodes.map(c => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(''); },
  });
  return el;
}

function simpleInlineToMd(html) {
  const root = fakeEl('body');
  const stack = [root];
  let pos = 0;
  SIMPLE_TOKEN.lastIndex = 0;
  let m;
  while ((m = SIMPLE_TOKEN.exec(html)) !== null) {
    if (m.index !== pos) return null; // gap = something we don't handle
    pos = SIMPLE_TOKEN.lastIndex;
    const cur = stack[stack.length - 1];
    if (m[3] !== undefined) {
      cur.childNodes.push({ nodeType: 3, nodeValue: m[3] });
    } else if (m[1]) {
      if (stack.length < 2 || stack[stack.length - 1].nodeName !== m[2].toUpperCase()) return null;
      stack.pop();
    } else {
      const el = fakeEl(m[2]);
      cur.childNodes.push(el);
      stack.push(el);
    }
  }
  if (pos !== html.length || stack.length !== 1) return null;
  let out = '';
  for (const c of root.childNodes) out += nodeToMd(c, false);
  return out.trim();
}

/**
 * Inline HTML (as stored in block.data.html) -> inline markdown.
 * @param {string} html
 * @returns {string}
 */
export function inlineHTMLToMarkdown(html) {
  if (!html) return '';
  if (!/[<&]/.test(html)) return escText(html.replace(/ /g, ' ').replace(/[\r\n]+/g, ' '));
  const fast = simpleInlineToMd(html);
  if (fast !== null) return fast;
  const clean = sanitizeHTML(html);
  if (!_parser) _parser = new DOMParser();
  const body = _parser.parseFromString(`<body>${clean}`, 'text/html').body;
  let s = '';
  for (const c of body.childNodes) s += nodeToMd(c, false);
  return s.trim();
}

/** Inline markdown for a block's text content (html or plain text). */
function inlineOf(data) {
  if (!data) return '';
  if (typeof data.html === 'string') return inlineHTMLToMarkdown(data.html);
  if (typeof data.text === 'string') {
    return escText(data.text).replace(/\r?\n/g, '<br>');
  }
  return '';
}

const cellText = (c) => escText(String(c ?? '').replace(/\r?\n/g, ' ')).replace(/\|/g, '\\|');

function fenceFor(code) {
  let n = 3;
  const runs = code.match(/`+/g);
  if (runs) n = Math.max(3, ...runs.map(r => r.length + 1));
  return '`'.repeat(n);
}

function emit(blocks, items, counter) {
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    const d = b.data || {};
    switch (b.type) {
      case 'markdown':
        if (d.markdown && d.markdown.trim()) items.push({ md: d.markdown.replace(/\s+$/, ''), kind: 'block' });
        break;
      case 'paragraph': {
        const t = inlineOf(d);
        if (t.trim()) items.push({ md: guardLineStart(t), kind: 'block' });
        break;
      }
      case 'heading': {
        const level = Math.min(6, Math.max(1, d.level || 1));
        const t = inlineOf(d);
        if (t.trim()) items.push({ md: `${'#'.repeat(level)} ${t}`, kind: 'block' });
        break;
      }
      case 'quote': {
        const t = inlineOf(d);
        if (t.trim()) items.push({ md: `> ${t}`, kind: 'block' });
        break;
      }
      case 'bulleted_list':
        items.push({ md: `- ${inlineOf(d)}`, kind: 'ul' });
        break;
      case 'numbered_list': {
        const prev = items[items.length - 1];
        counter.n = prev && prev.kind === 'ol' ? counter.n + 1 : 1;
        items.push({ md: `${counter.n}. ${inlineOf(d)}`, kind: 'ol' });
        break;
      }
      case 'code': {
        const code = d.code || '';
        const f = fenceFor(code);
        items.push({ md: `${f}${d.language || ''}\n${code}\n${f}`, kind: 'block' });
        break;
      }
      case 'divider':
        items.push({ md: '---', kind: 'block' });
        break;
      case 'table': {
        const rows = Array.isArray(d.rows) ? d.rows.filter(Array.isArray) : [];
        if (!rows.length) break;
        const width = Math.max(...rows.map(r => r.length), 1);
        const line = (r) => {
          const cells = r.map(cellText);
          while (cells.length < width) cells.push('');
          return `| ${cells.join(' | ')} |`;
        };
        const [head, ...body] = rows;
        const sep = `| ${Array(width).fill('---').join(' | ')} |`;
        items.push({ md: [line(head), sep, ...body.map(line)].join('\n'), kind: 'block' });
        break;
      }
      case 'image': {
        if (!d.src) break;
        const title = d.caption ? ` "${String(d.caption).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : '';
        items.push({ md: `![${escText(d.alt || '')}](${encodeUrl(d.src)}${title})`, kind: 'block' });
        break;
      }
      case 'audio':
      case 'video': {
        if (!d.src) break;
        items.push({ md: `![${escText(d.caption || '')}](${encodeUrl(d.src)})`, kind: 'block' });
        break;
      }
      case 'formula': {
        if (!d.latex) break;
        const latex = String(d.latex).replace(/\r?\n/g, ' ');
        items.push({ md: d.displayMode === false ? `$${latex}$` : `$$${latex}$$`, kind: 'block' });
        break;
      }
      case 'columns': {
        warnOnce('columns', 'columns layout flattened to a single column when converting to markdown');
        const cols = Array.isArray(d.columns) ? d.columns
          : Array.isArray(d.children) ? d.children
          : (Array.isArray(b.children) ? [b.children] : []);
        for (const col of cols) emit(Array.isArray(col) ? col : [], items, counter);
        continue;
      }
      default: {
        const t = inlineOf(d);
        if (t.trim()) {
          warnOnce('unk:' + b.type, `unknown block type "${b.type}" converted to a paragraph in markdown`);
          items.push({ md: guardLineStart(t), kind: 'block' });
        } else {
          warnOnce('unk:' + b.type, `block type "${b.type}" has no markdown representation and was skipped`);
        }
      }
    }
    if (b.type !== 'columns' && Array.isArray(b.children) && b.children.length) {
      warnOnce('children', 'nested block children flattened when converting to markdown');
      emit(b.children, items, counter);
    }
  }
}

/**
 * Convert BRE blocks (any mix of types, including 'markdown' blocks) to markdown.
 * @param {Array<object>} blocks
 * @returns {string}
 */
export function blocksToMarkdown(blocks) {
  if (!Array.isArray(blocks)) return '';
  const items = [];
  emit(blocks, items, { n: 0 });
  let out = '';
  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      const a = items[i - 1].kind;
      out += (a === items[i].kind && (a === 'ul' || a === 'ol')) ? '\n' : '\n\n';
    }
    out += items[i].md;
  }
  return out;
}
