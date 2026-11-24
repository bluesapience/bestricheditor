/**
 * DOMPurify wrapper for Best Rich Editor.
 * Provides safe HTML sanitization and URL validation.
 */
import DOMPurify from 'dompurify';

// Never allowed in editor content: they can restyle the host page (style), phish (form controls)
// or pull in external resources (link/meta/base).
export const FORBIDDEN_TAGS = ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'link', 'meta', 'base', 'object', 'embed'];

const KATEX_TAGS = [
  'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo',
  'mspace', 'mtext', 'mstyle', 'mfrac', 'msqrt', 'mover', 'munder',
  'msup', 'msub', 'msubsup', 'msupsub', 'svg', 'path', 'line', 'g', 'use', 'defs',
];

// Only youtube-nocookie.com and player.vimeo.com embeds are allowed in iframes.
const SAFE_IFRAME_ORIGINS = [
  'https://www.youtube-nocookie.com/embed/',
  'https://player.vimeo.com/video/',
];

// KaTeX positions glyphs with inline styles. Only these properties, with plain
// numeric values (or a simple color), survive. Anything else — url(), escapes,
// expression(), unknown properties — is dropped. (Allowlist, not denylist.)
const STYLE_PROPS = new Set([
  'height', 'width', 'min-width', 'vertical-align', 'top', 'left', 'margin-left', 'margin-right',
  'padding-left', 'border-bottom-width', 'font-size',
]);
const NUM_VALUE = /^-?(?:\d+\.?\d*|\.\d+)(?:em|ex|px|pt|%)?$/;
const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|[a-z]{3,20})$/i;

function cleanStyle(str) {
  if (str.indexOf('\\') !== -1) return ''; // no CSS escapes
  const out = [];
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if ((STYLE_PROPS.has(prop) && NUM_VALUE.test(val)) || (prop === 'color' && COLOR_VALUE.test(val))) {
      out.push(prop + ':' + val);
    }
  }
  return out.join(';');
}

// `data:` URIs are never allowed in editor HTML (images, video, links, SVG <image href>…):
// DOMPurify permits them on media tags by default, which would smuggle inline payloads.
const URI_ATTRS = new Set(['src', 'href', 'xlink:href', 'poster', 'action', 'formaction', 'background', 'data', 'ping']);
const DATA_URI = /^[\s\u0000-\u001f]*data:/i;
function blockDataUris(_node, ev) {
  const name = (ev.attrName || '').toLowerCase();
  if (URI_ATTRS.has(name) && DATA_URI.test(ev.attrValue)) ev.keepAttr = false;
  else if (name === 'srcset' && /(^|[\s,])data:/i.test(ev.attrValue)) ev.keepAttr = false;
}

function isSafeIframeSrc(src) {
  return SAFE_IFRAME_ORIGINS.some(prefix => src.startsWith(prefix));
}

/**
 * Sanitize HTML using DOMPurify with a safe profile.
 * Allows common formatting tags but strips scripts and dangerous attributes.
 *
 * @param {string} html
 * @param {{ allowKaTeX?: boolean, allowMedia?: boolean }} [options]
 */
export function sanitizeHTML(html, opts = {}) {
  return runSanitize(html, opts, false);
}

/**
 * Same policy as sanitizeHTML, but returns a DocumentFragment so callers can
 * append it directly — one parse instead of DOMPurify's parse + innerHTML's.
 */
export function sanitizeToFragment(html, opts = {}) {
  return runSanitize(html, opts, true);
}

function runSanitize(html, { allowKaTeX = false, allowMedia = false, allowButtons = false } = {}, asFragment) {
  if (typeof html !== 'string') html = '';
  const extra = asFragment ? { RETURN_DOM_FRAGMENT: true } : null;
  // `allowButtons` is ONLY for markup the editor generates itself (BREW's table
  // controls); user content never gets <button>.
  const forbidTags = allowButtons ? FORBIDDEN_TAGS.filter((t) => t !== 'button') : FORBIDDEN_TAGS;

  // Fast path: markup needs a '<' to create any element or attribute. Entity
  // text (&lt;script&gt;) only ever decodes to text, so a string with no '<'
  // is already safe and skips the DOMPurify parse entirely.
  if (html.indexOf('<') === -1) {
    if (!asFragment) return html;
    const f = document.createDocumentFragment();
    f.appendChild(document.createTextNode(html.replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e])));
    return f;
  }

  // Inline styles are never carried by the editor (it has no styling opinions
  // and style attributes can smuggle url()/expression()). KaTeX output is the
  // one exception — it needs style for layout — and is scrubbed by a hook below.
  if (!allowKaTeX && !allowMedia) {
    // id/name are dropped: they let content clobber window/document globals (DOM clobbering).
    DOMPurify.addHook('uponSanitizeAttribute', blockDataUris);
    try {
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_ATTR: ['style', 'id', 'name'], FORBID_TAGS: forbidTags, ...extra });
    } finally {
      DOMPurify.removeHook('uponSanitizeAttribute');
    }
  }

  const addTags = allowKaTeX ? [...KATEX_TAGS] : [];
  // `style` is only ever allowed for KaTeX output, and is allowlist-filtered below.
  const addAttr = ['encoding', 'contenteditable'];
  if (allowKaTeX) addAttr.push('style');

  if (allowMedia) {
    // Allow iframe for embed-only srcs; DOMPurify hook validates the src.
    addTags.push('iframe');
    addAttr.push('sandbox', 'referrerpolicy', 'allowfullscreen', 'loading', 'controls');
  }

  // Hook: strip iframe src unless it matches our embed allowlist, and reduce
  // style attributes to the KaTeX layout allowlist above.
  const hook = (node) => {
    if (allowMedia && node.tagName === 'IFRAME') {
      const src = node.getAttribute('src') || '';
      if (!isSafeIframeSrc(src)) node.removeAttribute('src');
    }
    if (node.hasAttribute && node.hasAttribute('style')) {
      const cleaned = allowKaTeX ? cleanStyle(node.getAttribute('style')) : '';
      if (cleaned) node.setAttribute('style', cleaned);
      else node.removeAttribute('style');
    }
  };

  DOMPurify.addHook('afterSanitizeAttributes', hook);
  DOMPurify.addHook('uponSanitizeAttribute', blockDataUris);

  let result;
  try {
    result = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, ...(allowKaTeX ? { svg: true, mathMl: true } : {}) },
    ADD_ATTR: addAttr,
    ADD_TAGS: addTags,
    FORBID_TAGS: forbidTags,
    // Never let content's id/name clobber globals: DOMPurify prefixes them (user-content-…).
    SANITIZE_NAMED_PROPS: true,
    ...(allowKaTeX ? {} : { FORBID_ATTR: ['style'] }),
    ...extra,
    });
  } finally {
    // Always unhook: the ESM build shares the host app's DOMPurify instance.
    DOMPurify.removeHook('afterSanitizeAttributes');
    DOMPurify.removeHook('uponSanitizeAttribute');
  }

  return result;
}

/**
 * Sanitize a URL — allow only http, https, and mailto protocols.
 * Returns empty string for javascript: and data: URLs.
 */
export function sanitizeURL(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed, window.location.href);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      return trimmed;
    }
    return '';
  } catch {
    // Relative URL
    if (/^(javascript|data):/i.test(trimmed)) return '';
    return trimmed;
  }
}
