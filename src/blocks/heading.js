/**
 * Heading block plugin (supports levels 1-6).
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';

blockRegistry.register('heading', {
  render(block) {
    const level = (block.data && block.data.level) || 1;
    const el = document.createElement(`h${level}`);
    el.className = `bre-block-content bre-heading bre-heading--${level}`;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-bre-field', 'text');
    el.setAttribute('data-bre-placeholder', `Heading ${level}`);
    el.textContent = (block.data && block.data.text) || '';
    return el;
  },

  toHTML(block) {
    const level = (block.data && block.data.level) || 1;
    const text = (block.data && block.data.text) || '';
    return `<h${level}>${escapeHTML(text)}</h${level}>`;
  },

  validate(block) {
    if (!block.data) return false;
    const level = block.data.level;
    return (
      Number.isInteger(level) &&
      level >= 1 &&
      level <= 6 &&
      typeof block.data.text === 'string'
    );
  },

  capabilities: {
    inline: true,
    marks: ['bold', 'italic'],
    links: false,
  },
});
