/**
 * Divider (horizontal rule) block plugin.
 */
import { blockRegistry } from '../core/blockRegistry.js';

blockRegistry.register('divider', {
  render(/* block */) {
    const el = document.createElement('hr');
    el.className = 'bre-divider';
    return el;
  },

  toHTML(/* block */) {
    return '<hr>';
  },

  validate(/* block */) {
    return true;
  },

  capabilities: {
    inline: false,
    marks: [],
    links: false,
  },
});
