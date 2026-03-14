/**
 * Columns block plugin — 2-, 3-, or 4-column layout.
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';

const DRAG_HANDLE_SVG = `<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="3" cy="2" r="1.5"/>
  <circle cx="7" cy="2" r="1.5"/>
  <circle cx="3" cy="6" r="1.5"/>
  <circle cx="7" cy="6" r="1.5"/>
  <circle cx="3" cy="10" r="1.5"/>
  <circle cx="7" cy="10" r="1.5"/>
  <circle cx="3" cy="14" r="1.5"/>
  <circle cx="7" cy="14" r="1.5"/>
</svg>`;

/**
 * Render a sub-block inside a column with the same wrapper structure
 * as the main renderer, so event delegation works uniformly.
 */
function renderSubBlock(subBlock) {
  const plugin = blockRegistry.get(subBlock.type);
  const contentEl = plugin.render(subBlock);

  const handle = document.createElement('div');
  handle.className = 'bre-drag-handle';
  handle.setAttribute('data-bre-handle', '');
  handle.setAttribute('aria-hidden', 'true');
  handle.innerHTML = DRAG_HANDLE_SVG;

  const wrapper = document.createElement('div');
  wrapper.className = `bre-block bre-block--${subBlock.type}`;
  wrapper.setAttribute('data-bre-block-id', subBlock.id);
  wrapper.appendChild(handle);
  wrapper.appendChild(contentEl);

  return wrapper;
}

/**
 * Render column HTML for toHTML.
 */
function colToHTML(colBlocks) {
  return colBlocks.map(b => {
    const plugin = blockRegistry.get(b.type);
    return plugin.toHTML(b);
  }).join('\n');
}

blockRegistry.register('columns', {
  render(block) {
    const container = document.createElement('div');
    container.className = 'bre-columns';

    const cols = (block.data && block.data.columns) || [[], []];
    container.setAttribute('data-bre-cols', String(cols.length));
    cols.forEach((colBlocks, colIndex) => {
      const colEl = document.createElement('div');
      colEl.className = 'bre-column';
      colEl.setAttribute('data-bre-column', String(colIndex));

      (colBlocks || []).forEach(subBlock => {
        colEl.appendChild(renderSubBlock(subBlock));
      });

      container.appendChild(colEl);
    });

    return container;
  },

  toHTML(block) {
    const cols = (block.data && block.data.columns) || [[], []];
    const colsHTML = cols.map(col =>
      `<div class="bre-column">\n${colToHTML(col)}\n</div>`
    ).join('\n');
    return `<div class="bre-columns" data-bre-cols="${cols.length}">\n${colsHTML}\n</div>`;
  },

  validate(block) {
    return (
      block.data &&
      Array.isArray(block.data.columns) &&
      block.data.columns.length >= 2 && block.data.columns.length <= 4
    );
  },

  capabilities: {
    inline: false,
    marks: [],
    links: false,
  },
});

export { renderSubBlock };
