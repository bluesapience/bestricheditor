/**
 * Heading block plugin (supports levels 1-6).
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';
import { sanitizeHTML } from '../utils/sanitize.js';

blockRegistry.register('heading', {
  render(block) {
    const level = (block.data && block.data.level) || 1;
    const el = document.createElement(`h${level}`);
    el.className = `bre-block-content bre-heading bre-heading--${level}`;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-bre-field', 'html');
    el.setAttribute('data-bre-placeholder', `Heading ${level}`);
    const rawHTML = block.data?.html ?? escapeHTML(block.data?.text ?? '');
    el.innerHTML = sanitizeHTML(rawHTML);
    return el;
  },

  toHTML(block) {
    const level = (block.data && block.data.level) || 1;
    const html = block.data?.html != null ? sanitizeHTML(block.data.html) : escapeHTML(block.data?.text ?? '');
    return `<h${level}>${html}</h${level}>`;
  },

  validate(block) {
    if (!block.data) return false;
    const level = block.data.level;
    return (
      Number.isInteger(level) &&
      level >= 1 &&
      level <= 6 &&
      (typeof block.data.html === 'string' || typeof block.data.text === 'string')
    );
  },

  capabilities: {
    inline: true,
    marks: ['bold', 'italic'],
    links: false,
  },
});
