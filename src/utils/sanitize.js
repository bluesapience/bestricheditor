/**
 * DOMPurify wrapper for Best Rich Editor.
 * Provides safe HTML sanitization and URL validation.
 */
import DOMPurify from 'dompurify';

/**
 * Sanitize HTML using DOMPurify with a safe profile.
 * Allows common formatting tags but strips scripts and dangerous attributes.
 *
 * @param {string} html
 * @param {{ allowKaTeX?: boolean }} [options]
 */
export function sanitizeHTML(html, { allowKaTeX = false } = {}) {
  if (typeof html !== 'string') return '';
  if (!allowKaTeX) {
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_ATTR: ['style', 'encoding'],
    ADD_TAGS: [
      'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo',
      'mspace', 'mtext', 'mstyle', 'mfrac', 'msqrt', 'mover', 'munder',
      'msup', 'msub', 'msubsup', 'msupsub', 'svg', 'path', 'line', 'g', 'use', 'defs',
    ],
  });
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
