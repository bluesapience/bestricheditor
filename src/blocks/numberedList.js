/**
 * Numbered list item block plugin.
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';
import { sanitizeHTML } from '../utils/sanitize.js';

blockRegistry.register('numbered_list', {
  render(block) {
    const el = document.createElement('li');
    el.className = 'bre-block-content bre-numbered-list';
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-bre-field', 'html');
    el.setAttribute('data-bre-placeholder', 'List item');
    const rawHTML = block.data?.html ?? escapeHTML(block.data?.text ?? '');
    el.innerHTML = sanitizeHTML(rawHTML);
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
