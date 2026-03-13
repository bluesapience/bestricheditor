import { createEditor } from '/dist/bre.esm.js';

const container = document.getElementById('bre-demo');
const editor = createEditor(container, { mode: 'BRE' });

// Expose on window for manual testing in the browser console
window.__bre = editor;
