/**
 * Code block plugin.
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';

blockRegistry.register('code', {
  render(block) {
    const wrapper = document.createElement('div');
    wrapper.className = 'bre-code-wrapper';

    const lang = block.data && block.data.language;
    if (lang) {
      const langLabel = document.createElement('div');
      langLabel.className = 'bre-code-lang';
      langLabel.textContent = lang;
      wrapper.appendChild(langLabel);
    }

    const pre = document.createElement('pre');
    pre.className = 'bre-code';

    const code = document.createElement('code');
    code.setAttribute('contenteditable', 'true');
    code.setAttribute('data-bre-field', 'code');
    code.setAttribute('spellcheck', 'false');
    code.setAttribute('data-bre-placeholder', '// Code\u2026');
    code.textContent = (block.data && block.data.code) || '';

    pre.appendChild(code);
    wrapper.appendChild(pre);
    return wrapper;
  },

  toHTML(block) {
    const lang = (block.data && block.data.language) || '';
    const code = (block.data && block.data.code) || '';
    const langAttr = lang ? ` class="language-${escapeHTML(lang)}"` : '';
    return `<pre><code${langAttr}>${escapeHTML(code)}</code></pre>`;
  },

  validate(block) {
    return block.data && typeof block.data.code === 'string';
  },

  capabilities: {
    inline: false,
    marks: [],
    links: false,
  },
});
