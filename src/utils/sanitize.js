/**
 * DOMPurify wrapper for Best Rich Editor.
 * Provides safe HTML sanitization and URL validation.
 */
import DOMPurify from 'dompurify';

/**
 * Sanitize HTML using DOMPurify with a safe profile.
 * Allows common formatting tags but strips scripts and dangerous attributes.
 */
export function sanitizeHTML(html) {
  if (typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 'code', 'pre', 'blockquote',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'a', 'span', 'div',
      'hr',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img',
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'alt', 'src', 'class', 'id',
      'data-bre-block-id', 'data-bre-field', 'data-bre-handle',
      'data-bre-column',
      'target', 'rel',
    ],
    ALLOW_DATA_ATTR: false,
    FORCE_BODY: false,
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
