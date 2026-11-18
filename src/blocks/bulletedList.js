/**
 * Bulleted list item block plugin.
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML, setInlineContent } from '../utils/dom.js';
import { DEFAULT_MESSAGES } from '../core/messages.js';
import { sanitizeHTML } from '../utils/sanitize.js';

blockRegistry.register('bulleted_list', {
  render(block, ctx) {
    const m = ctx?.messages || DEFAULT_MESSAGES;
    const el = document.createElement('li');
    el.className = 'bre-block-content bre-bulleted-list';
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-bre-field', 'html');
    el.setAttribute('data-bre-placeholder', m.listItem);
    setInlineContent(el, block.data);
    return el;
  },

  toHTML(block) {
    const html = block.data?.html != null ? sanitizeHTML(block.data.html) : escapeHTML(block.data?.text ?? '');
    return `<li>${html}</li>`;
  },

  validate(block) {
    return block.data && (typeof block.data.html === 'string' || typeof block.data.text === 'string');
  },

  capabilities: {
    inline: true,
    marks: ['bold', 'italic'],
    links: true,
  },
});
