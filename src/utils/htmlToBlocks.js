/**
 * Parse an HTML string into an array of BRE blocks.
 * Used by the paste pipeline.
 */
import DOMPurify from 'dompurify';
import { generateId } from './id.js';

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
      const text = node.textContent.trim();
      if (text) {
        blocks.push(makeBlock('paragraph', { text }));
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
      const text = node.textContent.trim();
      if (text) {
        blocks.push(makeBlock('heading', { level, text }));
      }
      break;
    }

    case 'BLOCKQUOTE': {
      const text = node.textContent.trim();
      if (text) {
        blocks.push(makeBlock('quote', { text }));
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
          const text = child.textContent.trim();
          if (text) {
            blocks.push(makeBlock('bulleted_list', { text }));
          }
        }
      }
      break;
    }

    case 'OL': {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toUpperCase() === 'LI') {
          const text = child.textContent.trim();
          if (text) {
            blocks.push(makeBlock('numbered_list', { text }));
          }
        }
      }
      break;
    }

    case 'HR': {
      blocks.push(makeBlock('divider', {}));
      break;
    }

    default:
      // Unknown elements — skip (don't recurse into them)
      break;
  }
}
