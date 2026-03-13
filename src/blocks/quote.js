/**
 * Quote (blockquote) block plugin.
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';

blockRegistry.register('quote', {
  render(block) {
    const el = document.createElement('blockquote');
    el.className = 'bre-block-content bre-quote';
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-bre-field', 'text');
    el.setAttribute('data-bre-placeholder', 'Quote\u2026');
    el.textContent = (block.data && block.data.text) || '';
    return el;
  },

  toHTML(block) {
    const text = (block.data && block.data.text) || '';
    return `<blockquote>${escapeHTML(text)}</blockquote>`;
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
