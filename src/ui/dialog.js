/**
 * Small inline dialog shared by BRE and BREW (link, media, formula, URL…).
 *
 * Esc closes and returns focus (and selection); Enter confirms; clicking
 * outside closes. It is positioned from an anchor (Element / Range) inside the
 * editor root: just below the anchor, or on the anchor's top-left corner, and
 * optionally as wide as the anchor's block.
 */

/**
 * @param {{
 *   getRoot: () => Element,                   positioned ancestor the dialog is appended to
 *   messages: { save: string, cancel: string, remove: string },
 *   fallbackEls?: () => Element[],            anchors to use when the anchor has no rect (collapsed range)
 *   focusEl?: () => Element | null,           what to focus when the dialog closes (default: whatever had focus)
 *   isDestroyed?: () => boolean,
 * }} cfg
 */
export function createDialogs({ getRoot, messages, fallbackEls = () => [], focusEl = () => null, isDestroyed = () => false }) {
  let active = null;

  const rectOf = (a) => {
    try { return a && a.getBoundingClientRect ? a.getBoundingClientRect() : null; } catch (_) { return null; }
  };

  function position(dialog, anchor, atCorner, spanWidth) {
    let r = rectOf(anchor);
    if (!r || (!r.width && !r.height)) {
      r = null;
      for (const el of fallbackEls()) { r = rectOf(el); if (r) break; }
    }
    if (!r) return;
    const rootRect = getRoot().getBoundingClientRect();
    // spanWidth: as wide as the block being edited (never narrower than a usable form).
    if (spanWidth) dialog.style.width = Math.min(Math.max(r.width, 280), rootRect.width || r.width) + 'px';
    // atCorner: dialog's top-left sits on the anchor's top-left; otherwise just below it.
    // Offsets are measured from the root's padding box and include its own scroll
    // (a host may make the editor scrollable).
    const root = getRoot();
    const originTop = rootRect.top + (root.clientTop || 0) - (root.scrollTop || 0);
    const originLeft = rootRect.left + (root.clientLeft || 0) - (root.scrollLeft || 0);
    const top = atCorner ? r.top - originTop : r.bottom - originTop + 6;
    const maxLeft = Math.max(0, rootRect.width - (dialog.offsetWidth || 0)) + (root.scrollLeft || 0);
    const left = Math.max(0, Math.min(r.left - originLeft, maxLeft));
    dialog.style.top = top + 'px';
    dialog.style.left = left + 'px';
  }

  /**
   * `fields`: [{ key, type, placeholder, value }]. `onSave(values)` runs after
   * `validate(values)` returns no invalid keys. `onCancel` runs when the dialog is
   * dismissed without saving or removing.
   */
  function open({ className = 'bre-brew-link-dialog', label, fields, savedRange, anchor, atCorner, spanWidth, validate, onSave, onRemove, onCancel }) {
    if (active) active.close(false);

    const prevFocus = document.activeElement;
    const dialog = document.createElement('div');
    dialog.className = className;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', label);

    const inputs = {};
    for (const f of fields) {
      const input = document.createElement('input');
      input.type = f.type || 'text';
      input.placeholder = f.placeholder;
      input.setAttribute('aria-label', f.placeholder);
      input.value = f.value || '';
      input.className = 'bre-brew-link-input';
      dialog.appendChild(input);
      inputs[f.key] = input;
    }

    const actions = document.createElement('div');
    actions.className = 'bre-brew-link-actions';
    const mk = (text, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.className = cls;
      return b;
    };
    const saveBtn = mk(messages.save, 'bre-brew-link-save');
    const cancelBtn = mk(messages.cancel, 'bre-brew-link-cancel');
    let done = false; // saved or removed (so close() doesn't also report a cancel)
    if (onRemove) {
      const removeBtn = mk(messages.remove, 'bre-brew-link-remove');
      removeBtn.addEventListener('click', () => { done = true; close(true); onRemove(); });
      actions.appendChild(removeBtn);
    }
    actions.append(cancelBtn, saveBtn);
    dialog.appendChild(actions);

    let outsideTimer = null;
    const outside = (e) => { if (!dialog.contains(e.target)) close(false); };

    function close(restoreFocus) {
      clearTimeout(outsideTimer);
      document.removeEventListener('pointerdown', outside);
      dialog.remove();
      if (active && active.dialog === dialog) active = null;
      if (restoreFocus && !isDestroyed()) {
        const target = focusEl() || (prevFocus && prevFocus.isConnected ? prevFocus : null);
        if (target) target.focus();
        if (savedRange) {
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(savedRange);
        }
      }
      if (!done && onCancel) { done = true; onCancel(); }
    }

    saveBtn.addEventListener('click', () => {
      const values = {};
      for (const k of Object.keys(inputs)) values[k] = inputs[k].value.trim();
      for (const input of Object.values(inputs)) input.removeAttribute('aria-invalid');
      const bad = validate ? validate(values) : [];
      if (bad.length) {
        for (const k of bad) inputs[k].setAttribute('aria-invalid', 'true');
        inputs[bad[0]].focus();
        return;
      }
      done = true;
      close(true);
      onSave(values);
    });
    cancelBtn.addEventListener('click', () => close(true));
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveBtn.click(); }
    });

    getRoot().appendChild(dialog);
    position(dialog, anchor || savedRange, atCorner, spanWidth);
    // Deferred: the press that opened the dialog is still bubbling. (pointerdown, not
    // mousedown: the drag handle suppresses the compat mousedown.)
    outsideTimer = setTimeout(() => document.addEventListener('pointerdown', outside), 0);
    active = { dialog, close };
    const first = Object.values(inputs)[0];
    if (first) first.focus();
    return dialog;
  }

  return {
    open,
    isOpen: () => !!active,
    closeActive: (restoreFocus = false) => { if (active) active.close(restoreFocus); },
  };
}
