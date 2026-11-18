/**
 * Block actions menu (opened by clicking the drag handle, or Alt+Shift+M).
 *
 * Accessible menu: role="menu" / "menuitem", focus moves into the menu, Arrow
 * keys cycle, Enter activates, Escape closes and returns focus to the caller.
 */
let seq = 0;

/**
 * @param {{ messages: object, onClose?: () => void }} cfg
 */
export function createBlockMenu({ messages }) {
  const menu = document.createElement('div');
  menu.className = 'bre-slash-menu bre-block-menu';
  menu.id = 'bre-block-menu-' + (++seq);
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', messages.blockMenuLabel);
  menu.tabIndex = -1;
  menu.hidden = true;
  document.body.appendChild(menu);

  let items = [];
  let active = 0;
  let onPick = null;
  let onCloseCb = null;
  let outsideBound = false;
  let outsideTimer = null;

  function render() {
    menu.textContent = '';
    menu.setAttribute('aria-activedescendant', menu.id + '-item-' + active);
    items.forEach((it, i) => {
      const el = document.createElement('div');
      el.className = 'bre-slash-item';
      el.setAttribute('role', 'menuitem');
      el.id = menu.id + '-item-' + i;
      el.setAttribute('data-bre-menu-index', String(i));
      el.setAttribute('data-active', i === active ? 'true' : 'false');
      el.textContent = it.label;
      menu.appendChild(el);
    });
  }

  function setActive(i) {
    active = (i + items.length) % items.length;
    const els = menu.children;
    for (let k = 0; k < els.length; k++) els[k].setAttribute('data-active', k === active ? 'true' : 'false');
    menu.setAttribute('aria-activedescendant', menu.id + '-item-' + active);
  }

  function pick(i) {
    const it = items[i];
    const cb = onPick;
    hide(false);
    if (it && cb) cb(it.id);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); hide(true); }
  }

  function onMouseDown(e) {
    const el = e.target.closest('[data-bre-menu-index]');
    if (!el) return;
    e.preventDefault();
    pick(Number(el.getAttribute('data-bre-menu-index')));
  }

  function onOutside(e) {
    if (!menu.contains(e.target)) hide(false);
  }

  menu.addEventListener('keydown', onKeyDown);
  menu.addEventListener('mousedown', onMouseDown);

  /**
   * @param {DOMRect} anchorRect
   * @param {Array<{id: string, label: string}>} list
   * @param {(id: string) => void} onSelect
   * @param {() => void} [onClose]  called when dismissed without a pick (Escape)
   */
  function show(anchorRect, list, onSelect, onClose) {
    items = list;
    active = 0;
    onPick = onSelect;
    onCloseCb = onClose || null;
    render();
    menu.hidden = false;
    menu.style.top = '0px';
    menu.style.left = '0px';
    const h = menu.offsetHeight;
    const w = menu.offsetWidth;
    let top = anchorRect.bottom;
    let left = anchorRect.left;
    if (top + h > window.innerHeight) top = Math.max(0, window.innerHeight - h);
    if (left + w > window.innerWidth) left = Math.max(0, window.innerWidth - w);
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    menu.focus();
    // Defer so the opening click doesn't immediately dismiss it.
    outsideTimer = setTimeout(() => {
      outsideTimer = null;
      document.addEventListener('pointerdown', onOutside, true);
      outsideBound = true;
    }, 0);
  }

  function hide(returnFocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    unbindOutside();
    const cb = onCloseCb;
    onCloseCb = null;
    onPick = null;
    if (returnFocus && cb) cb();
  }

  function unbindOutside() {
    if (outsideTimer) { clearTimeout(outsideTimer); outsideTimer = null; }
    if (outsideBound) {
      document.removeEventListener('pointerdown', onOutside, true);
      outsideBound = false;
    }
  }

  function destroy() {
    unbindOutside();
    menu.removeEventListener('keydown', onKeyDown);
    menu.removeEventListener('mousedown', onMouseDown);
    menu.remove();
  }

  return { show, hide: () => hide(false), isVisible: () => !menu.hidden, destroy };
}
