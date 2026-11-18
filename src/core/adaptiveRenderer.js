/**
 * Renderer facade that picks plain or virtualized rendering per document.
 *
 *   virtualize: true   → always virtual
 *   virtualize: false  → never virtual
 *   virtualize: 'auto' → virtual when the document has more than `threshold`
 *                        blocks (decided on every full render)
 *
 * The facade object is stable, so callers (drag handles, editor) can hold it.
 */
import { createRenderer } from './renderer.js';
import { createVirtualRenderer } from './virtualRenderer.js';

export const DEFAULT_VIRTUALIZE_THRESHOLD = 300;

export function createAdaptiveRenderer(container, state, ctx, { virtualize = 'auto', threshold = DEFAULT_VIRTUALIZE_THRESHOLD } = {}) {
  let impl = null;
  let isVirtual = false;

  function want(n) {
    if (virtualize === true) return true;
    if (virtualize === false) return false;
    return n > threshold;
  }

  function ensure(wantVirtual) {
    if (impl && isVirtual === wantVirtual) return;
    if (impl) impl.destroy();
    impl = wantVirtual
      ? createVirtualRenderer(container, state, ctx)
      : createRenderer(container, ctx);
    isVirtual = wantVirtual;
  }

  ensure(virtualize === true);

  return {
    renderAll(blocks) {
      ensure(want(blocks.length));
      impl.renderAll(blocks);
    },
    updateBlock: (b) => impl.updateBlock(b),
    insertBlock: (b, afterId) => impl.insertBlock(b, afterId),
    removeBlock: (id) => impl.removeBlock(id),
    getBlockEl: (id) => impl.getBlockEl(id),
    isVirtual: () => isVirtual,
    destroy() {
      if (impl) impl.destroy();
      impl = null;
    },
  };
}
