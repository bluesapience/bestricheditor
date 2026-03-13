import { generateId } from '../utils/id.js';

/**
 * createEditor(container, options) -> editor
 *
 * Stage 0: mounts the editor shell with event delegation root.
 * Block rendering, keyboard handling, and API bodies land in Stage 1.
 */
export function createEditor(container, options = {}) {
  if (!(container instanceof Element)) {
    throw new Error('[bre] createEditor: container must be a DOM Element');
  }

  const opts = {
    mode: 'BRE',
    onChange: null,
    embedAllowlist: ['youtube.com', 'youtu.be', 'vimeo.com'],
    virtualize: false,
    ...options,
  };

  // ── mount ────────────────────────────────────────────────────────────────

  const root = document.createElement('div');
  root.className = 'bre-editor';
  root.setAttribute('data-bre-mode', opts.mode);
  root.setAttribute('tabindex', '0');

  const placeholder = document.createElement('p');
  placeholder.className = 'bre-placeholder';
  placeholder.textContent = 'Start typing or press / for commands…';
  root.appendChild(placeholder);

  // Event delegation root — block handlers attach here in Stage 1
  root.addEventListener('click', handleClick);
  root.addEventListener('keydown', handleKeydown);

  container.appendChild(root);

  // ── event handlers ───────────────────────────────────────────────────────

  function handleClick(/* e */) {
    // Stage 1: route click to focused block
  }

  function handleKeydown(/* e */) {
    // Stage 1: Enter → split, Backspace at start → merge, arrows → navigate
  }

  // ── public API ───────────────────────────────────────────────────────────

  return {
    getJSON() {
      // Stage 1: serialise block model to Document
      return {
        id: generateId(),
        version: 1,
        created: Date.now(),
        updated: Date.now(),
        blocks: [],
      };
    },

    setJSON(/* json */) {
      // Stage 1: load Document into editor
    },

    getHTML() {
      // Stage 1: serialise block model to sanitised HTML string
      return '';
    },

    destroy() {
      root.removeEventListener('click', handleClick);
      root.removeEventListener('keydown', handleKeydown);
      root.remove();
    },
  };
}
