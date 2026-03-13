/**
 * Table block plugin.
 * data: { rows: string[][] }
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';

blockRegistry.register('table', {
  render(block) {
    const rows =
      block.data && Array.isArray(block.data.rows) && block.data.rows.length > 0
        ? block.data.rows
        : [['Header 1', 'Header 2'], ['', '']];

    const wrapper = document.createElement('div');
    wrapper.className = 'bre-table-wrapper';

    const table = document.createElement('table');
    table.className = 'bre-table';

    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      (Array.isArray(row) ? row : []).forEach((cell, colIndex) => {
        const tag = rowIndex === 0 ? 'th' : 'td';
        const cellEl = document.createElement(tag);
        cellEl.className = 'bre-table-cell';
        cellEl.setAttribute('contenteditable', 'true');
        cellEl.setAttribute('data-bre-table-row', String(rowIndex));
        cellEl.setAttribute('data-bre-table-col', String(colIndex));
        cellEl.setAttribute('data-bre-placeholder', rowIndex === 0 ? 'Header' : 'Cell');
        cellEl.textContent = String(cell);
        tr.appendChild(cellEl);
      });
      if (rowIndex === 0) {
        thead.appendChild(tr);
      } else {
        tbody.appendChild(tr);
      }
    });

    table.appendChild(thead);
    if (rows.length > 1) table.appendChild(tbody);

    const controls = document.createElement('div');
    controls.className = 'bre-table-controls';

    [
      { action: 'add-row', label: '+ Row' },
      { action: 'del-row', label: '− Row' },
      { action: 'add-col', label: '+ Col' },
      { action: 'del-col', label: '− Col' },
    ].forEach(({ action, label }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bre-table-btn';
      btn.setAttribute('data-bre-table-action', action);
      btn.textContent = label;
      controls.appendChild(btn);
    });

    wrapper.appendChild(table);
    wrapper.appendChild(controls);
    return wrapper;
  },

  toHTML(block) {
    const rows = block.data && Array.isArray(block.data.rows) ? block.data.rows : [];
    if (rows.length === 0) return '';
    const [headerRow, ...bodyRows] = rows;
    const thead = headerRow
      ? `<thead><tr>${headerRow.map(c => `<th>${escapeHTML(String(c))}</th>`).join('')}</tr></thead>`
      : '';
    const tbody =
      bodyRows.length > 0
        ? `<tbody>${bodyRows
            .map(row => `<tr>${(Array.isArray(row) ? row : []).map(c => `<td>${escapeHTML(String(c))}</td>`).join('')}</tr>`)
            .join('\n')}</tbody>`
        : '';
    return `<table class="bre-table">\n${thead}\n${tbody}\n</table>`;
  },

  validate(block) {
    return (
      block.data &&
      Array.isArray(block.data.rows) &&
      block.data.rows.length > 0 &&
      block.data.rows.every(r => Array.isArray(r))
    );
  },

  capabilities: {
    inline: false,
    marks: [],
    links: false,
  },
});
