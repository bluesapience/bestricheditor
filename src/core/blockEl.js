/**
 * Shared block-element construction for the plain and virtual renderers.
 *
 * Each block is exactly two elements: the `.bre-block` wrapper and the plugin's
 * content element. The drag handle is a single shared element owned by the
 * editor (see ui/dragHandle.js), not per-block markup.
 */
import { blockRegistry } from './blockRegistry.js';

/** Toggle contenteditable on every editable descendant (and the node itself). */
export function applyReadOnly(el, readOnly) {
  const val = readOnly ? 'false' : 'true';
  if (el.hasAttribute('contenteditable')) el.setAttribute('contenteditable', val);
  const nodes = el.querySelectorAll('[contenteditable]');
  for (let i = 0; i < nodes.length; i++) nodes[i].setAttribute('contenteditable', val);
}

export function createBlockEl(block, ctx) {
  const plugin = blockRegistry.get(block.type);
  const content = plugin.render(block, ctx);
  const wrapper = document.createElement('div');
  wrapper.className = 'bre-block bre-block--' + block.type;
  wrapper.setAttribute('data-bre-block-id', block.id);
  wrapper.appendChild(content);
  if (ctx.isReadOnly()) applyReadOnly(wrapper, true);
  return wrapper;
}

/** Register sub-blocks of a columns block's element in a flat id → element map. */
export function registerSubBlocks(blockMap, columnsWrapperEl) {
  const nodes = columnsWrapperEl.querySelectorAll('[data-bre-block-id]');
  for (let i = 0; i < nodes.length; i++) {
    blockMap.set(nodes[i].getAttribute('data-bre-block-id'), nodes[i]);
  }
}
