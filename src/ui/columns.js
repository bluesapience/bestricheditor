/**
 * Columns block plugin — 2-, 3-, or 4-column layout.
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { createBlockEl } from '../core/blockEl.js';

function colToHTML(colBlocks, ctx) {
  return colBlocks.map(b => blockRegistry.get(b.type).toHTML(b, ctx)).join('\n');
}

blockRegistry.register('columns', {
  render(block, ctx) {
    const container = document.createElement('div');
    container.className = 'bre-columns';

    const cols = (block.data && block.data.columns) || [[], []];
    container.setAttribute('data-bre-cols', String(cols.length));
    cols.forEach((colBlocks, colIndex) => {
      const colEl = document.createElement('div');
      colEl.className = 'bre-column';
      colEl.setAttribute('data-bre-column', String(colIndex));
      for (const subBlock of colBlocks || []) {
        colEl.appendChild(createBlockEl(subBlock, ctx));
      }
      container.appendChild(colEl);
    });

    return container;
  },

  toHTML(block, ctx) {
    const cols = (block.data && block.data.columns) || [[], []];
    const colsHTML = cols
      .map(col => `<div class="bre-column">\n${colToHTML(col, ctx)}\n</div>`)
      .join('\n');
    return `<div class="bre-columns" data-bre-cols="${cols.length}">\n${colsHTML}\n</div>`;
  },

  validate(block) {
    return (
      block.data &&
      Array.isArray(block.data.columns) &&
      block.data.columns.length >= 2 && block.data.columns.length <= 4
    );
  },

  capabilities: { inline: false, marks: [], links: false },
});
