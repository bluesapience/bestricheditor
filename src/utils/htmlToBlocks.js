/**
 * Parse an HTML string into an array of BRE blocks.
 * Used by the paste pipeline.
 */
import DOMPurify from 'dompurify';
import { generateId } from './id.js';
import { sanitizeHTML, sanitizeURL } from './sanitize.js';

/**
 * Convert an HTML string to an array of BRE blocks.
 * @param {string} html
 * @returns {Array<{id: string, type: string, data: object}>}
 */
export function htmlToBlocks(html) {
  if (typeof html !== 'string' || !html.trim()) return [];

  const clean = DOMPurify.sanitize(html);
  const div = document.createElement('div');
  div.innerHTML = clean;

  const blocks = [];

  for (const node of div.childNodes) {
    processNode(node, blocks);
  }

  return blocks;
}

function makeBlock(type, data) {
  return { id: generateId(), type, data };
}

function processNode(node, blocks) {
  // Text nodes with non-empty content → paragraph
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim();
    if (text) {
      blocks.push(makeBlock('paragraph', { text }));
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName.toUpperCase();

  // Skip BR and empty nodes
  if (tag === 'BR') return;

  switch (tag) {
    case 'P':
    case 'DIV': {
      if (node.textContent.trim()) {
        blocks.push(makeBlock('paragraph', { html: sanitizeHTML(node.innerHTML) }));
      }
      break;
    }

    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = parseInt(tag[1], 10);
      if (node.textContent.trim()) {
        blocks.push(makeBlock('heading', { level, html: sanitizeHTML(node.innerHTML) }));
      }
      break;
    }

    case 'BLOCKQUOTE': {
      if (node.textContent.trim()) {
        blocks.push(makeBlock('quote', { html: sanitizeHTML(node.innerHTML) }));
      }
      break;
    }

    case 'PRE': {
      const codeEl = node.querySelector('code');
      const code = codeEl ? codeEl.textContent : node.textContent;
      blocks.push(makeBlock('code', { code, language: '' }));
      break;
    }

    case 'UL': {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toUpperCase() === 'LI') {
          if (child.textContent.trim()) {
            blocks.push(makeBlock('bulleted_list', { html: sanitizeHTML(child.innerHTML) }));
          }
        }
      }
      break;
    }

    case 'OL': {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toUpperCase() === 'LI') {
          if (child.textContent.trim()) {
            blocks.push(makeBlock('numbered_list', { html: sanitizeHTML(child.innerHTML) }));
          }
        }
      }
      break;
    }

    case 'HR': {
      blocks.push(makeBlock('divider', {}));
      break;
    }

    case 'TABLE': {
      const rows = [];
      for (const tr of node.querySelectorAll('tr')) {
        const row = [];
        for (const cell of tr.querySelectorAll('th, td')) {
          row.push(cell.textContent.trim());
        }
        if (row.length > 0) rows.push(row);
      }
      if (rows.length > 0) blocks.push(makeBlock('table', { rows }));
      break;
    }

    case 'IMG': {
      const src = sanitizeURL(node.getAttribute('src') || '');
      if (src) {
        blocks.push(makeBlock('image', {
          src,
          alt: node.getAttribute('alt') || '',
          caption: '',
        }));
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
      // Unknown elements — skip (don't recurse into them)
      break;
  }
}
