/**
 * Formula block plugin — KaTeX rendered, click-to-edit.
 */
import { katexReady, getKaTeX, ensureKaTeXStyles } from '../utils/katex-lazy.js';
import { elt, escapeHTML } from '../utils/dom.js';
import { blockRegistry } from '../core/blockRegistry.js';

ensureKaTeXStyles();

function renderLatexInto(wrapper, latex, displayMode) {
  const katex = getKaTeX();
  if (!katex) return;
  try {
    wrapper.innerHTML = katex.renderToString(latex, { displayMode, throwOnError: false, output: 'html' });
  } catch {
    wrapper.textContent = latex;
  }
}

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

    if (!latex) {
      wrapper.appendChild(elt('span', { class: 'bre-formula-placeholder' }, 'Click to add formula…'));
      return wrapper;
    }

    if (getKaTeX()) {
      renderLatexInto(wrapper, latex, displayMode);
    } else {
      // KaTeX chunk still downloading — show raw source, update once ready.
      wrapper.textContent = latex;
      katexReady.then(() => renderLatexInto(wrapper, latex, displayMode));
    }

    return wrapper;
  },

  toHTML(block) {
    const latex = (block.data && block.data.latex) || '';
    const displayMode = block.data && block.data.displayMode != null ? block.data.displayMode : true;
    if (!latex) return '';
    const katex = getKaTeX();
    if (!katex) return `<code class="bre-formula-error">${escapeHTML(latex)}</code>`;
    try {
      return katex.renderToString(latex, { displayMode, throwOnError: false, output: 'html' });
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
