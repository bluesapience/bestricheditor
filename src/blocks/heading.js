/**
 * Heading block plugin (supports levels 1-6).
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML, setInlineContent } from '../utils/dom.js';
import { DEFAULT_MESSAGES } from '../core/messages.js';
import { sanitizeHTML } from '../utils/sanitize.js';

blockRegistry.register('heading', {
  render(block, ctx) {
    const m = ctx?.messages || DEFAULT_MESSAGES;
    const level = (block.data && block.data.level) || 1;
    const el = document.createElement(`h${level}`);
    el.className = `bre-block-content bre-heading bre-heading--${level}`;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-bre-field', 'html');
    el.setAttribute('data-bre-placeholder', m.heading.replace('{n}', String(level)));
    setInlineContent(el, block.data);
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
