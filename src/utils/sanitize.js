/**
 * DOMPurify wrapper for Best Rich Editor.
 * Provides safe HTML sanitization and URL validation.
 */
import DOMPurify from 'dompurify';

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
export function sanitizeHTML(html, { allowKaTeX = false, allowMedia = false } = {}) {
  if (typeof html !== 'string') return '';

  if (!allowKaTeX && !allowMedia) {
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }

  const addTags = allowKaTeX ? [...KATEX_TAGS] : [];
  const addAttr = ['style', 'encoding'];

  if (allowMedia) {
    // Allow iframe for embed-only srcs; DOMPurify hook validates the src.
    addTags.push('iframe');
    addAttr.push('sandbox', 'referrerpolicy', 'allowfullscreen', 'loading', 'controls');
  }

  // Hook: strip iframe src unless it matches our embed allowlist.
  const hook = allowMedia ? (node) => {
    if (node.tagName === 'IFRAME') {
      const src = node.getAttribute('src') || '';
      if (!isSafeIframeSrc(src)) node.removeAttribute('src');
    }
  } : null;

  if (hook) DOMPurify.addHook('afterSanitizeAttributes', hook);

  const result = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, ...(allowKaTeX ? { svg: true, mathMl: true } : {}) },
    ADD_ATTR: addAttr,
    ADD_TAGS: addTags,
  });

  if (hook) DOMPurify.removeHook('afterSanitizeAttributes');

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
