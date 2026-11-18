/**
 * Paragraph block plugin.
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML, setInlineContent } from '../utils/dom.js';
import { sanitizeHTML } from '../utils/sanitize.js';
import { DEFAULT_MESSAGES } from '../core/messages.js';

blockRegistry.register('paragraph', {
  render(block, ctx) {
    const el = document.createElement('p');
    el.className = 'bre-block-content bre-paragraph';
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-bre-field', 'html');
    el.setAttribute('data-bre-placeholder', (ctx?.messages || DEFAULT_MESSAGES).paragraphHint);
    setInlineContent(el, block.data);
    return el;
  },

  toHTML(block) {
    const html = block.data?.html != null ? sanitizeHTML(block.data.html) : escapeHTML(block.data?.text ?? '');
    return `<p>${html}</p>`;
  },

  validate(block) {
    return block.data && (typeof block.data.html === 'string' || typeof block.data.text === 'string');
  },

  capabilities: {
    inline: true,
    marks: ['bold', 'italic', 'underline', 'code'],
    links: true,
  },
});
