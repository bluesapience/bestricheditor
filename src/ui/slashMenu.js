/**
 * Slash menu — floating block inserter triggered by typing '/'.
 *
 * Accessibility: listbox/option roles; the owning editable field gets
 * aria-controls + aria-activedescendant so screen readers follow the selection.
 */

let menuSeq = 0;

/**
 * @param {Function} onSelect  called with the selected item object
 * @param {{ messages: object }} cfg
 */
export function createSlashMenu(onSelect, { messages }) {
  const menuId = 'bre-slash-' + (++menuSeq);
  const menuEl = document.createElement('div');
  menuEl.className = 'bre-slash-menu';
  menuEl.id = menuId;
  menuEl.setAttribute('role', 'listbox');
  menuEl.setAttribute('aria-label', messages.slashLabel);
  menuEl.hidden = true;
  document.body.appendChild(menuEl);

  let _items = [];
  let _filtered = [];
  let _activeIndex = 0;
  let _owner = null;

  function itemId(i) { return menuId + '-' + i; }

  function syncOwner() {
    if (!_owner) return;
    if (_filtered.length && !menuEl.hidden) {
      _owner.setAttribute('aria-controls', menuId);
      _owner.setAttribute('aria-activedescendant', itemId(_activeIndex));
    } else {
      _owner.removeAttribute('aria-controls');
      _owner.removeAttribute('aria-activedescendant');
    }
  }

  function renderItems() {
    menuEl.textContent = '';
    if (_filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bre-slash-empty';
      empty.setAttribute('role', 'status');
      empty.textContent = messages.slashNoResults;
      menuEl.appendChild(empty);
      syncOwner();
      return;
    }
    const frag = document.createDocumentFragment();
    _filtered.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'bre-slash-item';
      el.id = itemId(i);
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', i === _activeIndex ? 'true' : 'false');
      el.setAttribute('data-active', i === _activeIndex ? 'true' : 'false');
      el.setAttribute('data-bre-slash-index', String(i));

      const iconEl = document.createElement('span');
      iconEl.className = 'bre-slash-item__icon';
      iconEl.setAttribute('aria-hidden', 'true');
      iconEl.textContent = item.icon || '';

      const labelEl = document.createElement('span');
      labelEl.className = 'bre-slash-item__label';
      labelEl.textContent = item.label;

      const descEl = document.createElement('span');
      descEl.className = 'bre-slash-item__desc';
      descEl.textContent = item.description || '';

      el.append(iconEl, labelEl, descEl);
      frag.appendChild(el);
    });
    menuEl.appendChild(frag);
    syncOwner();
  }

  // One delegated listener instead of one per item.
  function onMouseDown(e) {
    const el = e.target.closest('[data-bre-slash-index]');
    if (!el) return;
    e.preventDefault(); // keep editor focus
    _activeIndex = Number(el.getAttribute('data-bre-slash-index'));
    confirm();
  }
  menuEl.addEventListener('mousedown', onMouseDown);

  function updateActive() {
    const items = menuEl.querySelectorAll('[role="option"]');
    items.forEach((el, i) => {
      const on = i === _activeIndex;
      el.setAttribute('data-active', on ? 'true' : 'false');
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const activeEl = items[_activeIndex];
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
    syncOwner();
  }

  function position(anchorRect) {
    menuEl.style.top = '0px';
    menuEl.style.left = '0px';
    const h = menuEl.offsetHeight;
    const w = menuEl.offsetWidth;
    let top = anchorRect.bottom;
    let left = anchorRect.left;
    if (top + h > window.innerHeight) top = Math.max(0, anchorRect.top - h);
    if (left + w > window.innerWidth) left = Math.max(0, window.innerWidth - w);
    menuEl.style.top = top + 'px';
    menuEl.style.left = left + 'px';
  }

  function show(anchorRect, items, ownerEl) {
    _items = items;
    _filtered = items.slice();
    _activeIndex = 0;
    _owner = ownerEl || null;
    menuEl.hidden = false;
    renderItems();
    position(anchorRect);
  }

  function hide() {
    menuEl.hidden = true;
    syncOwner();
    _filtered = [];
    _activeIndex = 0;
    _owner = null;
  }

  function isVisible() {
    return !menuEl.hidden;
  }

  function filter(query) {
    const q = query.toLowerCase();
    _filtered = _items.filter(item =>
      item.label.toLowerCase().includes(q) ||
      (item.description && item.description.toLowerCase().includes(q)) ||
      (item.keywords && item.keywords.some(k => k.toLowerCase().includes(q)))
    );
    _activeIndex = 0;
    renderItems();
  }

  function next() {
    if (_filtered.length === 0) return;
    _activeIndex = (_activeIndex + 1) % _filtered.length;
    updateActive();
  }

  function prev() {
    if (_filtered.length === 0) return;
    _activeIndex = (_activeIndex - 1 + _filtered.length) % _filtered.length;
    updateActive();
  }

  function confirm() {
    if (_filtered.length === 0) return;
    const item = _filtered[_activeIndex];
    if (item) {
      hide();
      onSelect(item);
    }
  }

  function destroy() {
    menuEl.removeEventListener('mousedown', onMouseDown);
    menuEl.remove();
  }

  return { show, hide, isVisible, filter, next, prev, confirm, destroy };
}
