/**
 * Block(s) -> sanitized HTML string, using the block registry plugins.
 * Shared by BREW (per-block cached) and usable standalone.
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { sanitizeHTML } from './sanitize.js';

const TEXT_TAGS = { paragraph: 'p', quote: 'blockquote', bulleted_list: 'li', numbered_list: 'li' };

const SIMPLE_TAG = /<(\/?)([a-z]+)\s*\/?>/gi;
const SIMPLE_NAMES = new Set(['b', 'i', 'u', 'em', 'strong', 'code', 's', 'del', 'sub', 'sup', 'mark', 'br']);

/**
 * True when `html` contains only text plus attribute-less, balanced
 * b/i/u/em/strong/code/s/del/sub/sup/mark/br tags — provably safe, so callers
 * can skip a DOMPurify round-trip for the (very common) simple case.
 */
export function isSimpleInlineHTML(html) {
  if (!html.includes('<')) return true;
  const stack = [];
  let last = 0;
  let m;
  SIMPLE_TAG.lastIndex = 0;
  while ((m = SIMPLE_TAG.exec(html))) {
    if (html.slice(last, m.index).includes('<')) return false;
    last = SIMPLE_TAG.lastIndex;
    const name = m[2].toLowerCase();
    if (!SIMPLE_NAMES.has(name)) return false;
    if (name === 'br') continue;
    if (m[1]) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  return !html.slice(last).includes('<') && stack.length === 0;
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * HTML for one block (list items come back as bare `<li>`; wrap with
 * `listWrapper` / use blocksToHTML for grouping).
 *
 * Text-like blocks (paragraph/heading/quote/list item) are built directly:
 * with `trusted: true` the block's `data.html` is assumed already sanitized
 * (as BREW's model guarantees) and no DOMPurify call is made. Everything else
 * goes through the registered plugin's toHTML and one sanitize pass.
 *
 * @param {{type:string,data:object}} block
 * @param {{trusted?: boolean}} [opts]
 * @returns {string}
 */
export function blockToHTML(block, { trusted = false, embedAllowlist } = {}) {
  if (!block) return '';
  const d = block.data || {};
  const type = block.type;
  const tag = type === 'heading' ? `h${Math.min(6, Math.max(1, d.level || 1))}` : TEXT_TAGS[type];
  if (tag) {
    let inner;
    if (typeof d.html === 'string') {
      inner = trusted || isSimpleInlineHTML(d.html) ? d.html : sanitizeHTML(d.html);
    } else {
      inner = escapeText(d.text ?? '');
    }
    return `<${tag}>${inner}</${tag}>`;
  }
  if (blockRegistry.has(type)) {
    const raw = blockRegistry.get(type).toHTML(block, embedAllowlist ? { embedAllowlist } : undefined);
    if (!raw) return '';
    // code/divider output is fully escaped by the plugin — skip DOMPurify
    if (type === 'code' || type === 'divider') return raw;
    return sanitizeHTML(raw, { allowKaTeX: type === 'formula', allowMedia: true });
  }
  return '';
}

/**
 * Serialize a block array, wrapping consecutive list items in <ul>/<ol>.
 * @param {Array<object>} blocks
 * @param {{trusted?: boolean}} [opts]
 * @returns {string}
 */
export function blocksToHTML(blocks, opts) {
  const parts = [];
  let open = null; // 'ul' | 'ol'
  for (const b of blocks) {
    const want = b.type === 'bulleted_list' ? 'ul' : b.type === 'numbered_list' ? 'ol' : null;
    if (open && open !== want) { parts.push(`</${open}>`); open = null; }
    if (want && !open) { parts.push(`<${want}>`); open = want; }
    const h = blockToHTML(b, opts);
    if (h) parts.push(h);
  }
  if (open) parts.push(`</${open}>`);
  return parts.join('\n');
}
