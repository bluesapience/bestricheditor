/**
 * Formula block plugin — KaTeX rendered, click-to-edit.
 */
import katex from 'katex';
import { elt, escapeHTML } from '../utils/dom.js';
import { blockRegistry } from '../core/blockRegistry.js';

function ensureKaTeXStyles() {
  if (document.getElementById('bre-katex-css')) return;
  const link = document.createElement('link');
  link.id = 'bre-katex-css';
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css';
  document.head.appendChild(link);
}

// Call immediately when module loads
ensureKaTeXStyles();

blockRegistry.register('formula', {
  render(block) {
    const latex = (block.data && block.data.latex) || '';
    const displayMode = block.data && block.data.displayMode != null ? block.data.displayMode : true;

    const wrapper = elt('div', {
      class: 'bre-formula',
      'data-bre-field': 'latex',
      tabindex: '0',
    });

    wrapper.dataset.breLatex = latex;

    if (latex) {
      try {
        const rendered = katex.renderToString(latex, {
          displayMode,
          throwOnError: false,
          output: 'html',
        });
        // KaTeX output is safe — it's generated programmatically
        wrapper.innerHTML = rendered;
      } catch {
        wrapper.textContent = latex;
      }
    } else {
      const placeholder = elt('span', { class: 'bre-formula-placeholder' }, 'Click to add formula…');
      wrapper.appendChild(placeholder);
    }

    return wrapper;
  },

  toHTML(block) {
    const latex = (block.data && block.data.latex) || '';
    const displayMode = block.data && block.data.displayMode != null ? block.data.displayMode : true;
    if (!latex) return '';
    try {
      return katex.renderToString(latex, {
        displayMode,
        throwOnError: false,
        output: 'html',
      });
    } catch {
      return `<code class="bre-formula-error">${escapeHTML(latex)}</code>`;
    }
  },

  validate(block) {
    return block.data && typeof block.data.latex === 'string';
  },

  capabilities: {
    inline: false,
    marks: [],
    links: false,
  },
});
