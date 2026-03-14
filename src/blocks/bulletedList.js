/**
 * Bulleted list item block plugin.
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';

blockRegistry.register('bulleted_list', {
  render(block) {
    const el = document.createElement('li');
    el.className = 'bre-block-content bre-bulleted-list';
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-bre-field', 'text');
    el.setAttribute('data-bre-placeholder', 'List item');
    el.textContent = (block.data && block.data.text) || '';
    return el;
  },

  toHTML(block) {
    const text = (block.data && block.data.text) || '';
    return `<li>${escapeHTML(text)}</li>`;
  },

  validate(block) {
    return block.data && typeof block.data.text === 'string';
  },

  capabilities: {
    inline: true,
    marks: ['bold', 'italic'],
    links: true,
  },
});
