/**
 * Paragraph block plugin.
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';

blockRegistry.register('paragraph', {
  render(block) {
    const el = document.createElement('p');
    el.className = 'bre-block-content bre-paragraph';
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-bre-field', 'text');
    el.setAttribute('data-bre-placeholder', 'Type something, or press / for commands');
    el.textContent = (block.data && block.data.text) || '';
    return el;
  },

  toHTML(block) {
    const text = (block.data && block.data.text) || '';
    return `<p>${escapeHTML(text)}</p>`;
  },

  validate(block) {
    return block.data && typeof block.data.text === 'string';
  },

  capabilities: {
    inline: true,
    marks: ['bold', 'italic', 'underline', 'code'],
    links: true,
  },
});
