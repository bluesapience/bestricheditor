/**
 * Slash menu — floating block inserter triggered by typing '/'.
 */

/**
 * Create a slash menu.
 * @param {Function} onSelect - called with the selected item object
 */
export function createSlashMenu(onSelect) {
  const menuEl = document.createElement('div');
  menuEl.className = 'bre-slash-menu';
  menuEl.style.display = 'none';
  menuEl.style.position = 'fixed';
  menuEl.style.zIndex = '9999';
  document.body.appendChild(menuEl);

  let _items = [];
  let _filtered = [];
  let _activeIndex = 0;

  function renderItems() {
    menuEl.innerHTML = '';
    if (_filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bre-slash-empty';
      empty.textContent = 'No results';
      menuEl.appendChild(empty);
      return;
    }
    _filtered.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'bre-slash-item';
      el.setAttribute('data-active', i === _activeIndex ? 'true' : 'false');

      const iconEl = document.createElement('span');
      iconEl.className = 'bre-slash-item__icon';
      iconEl.textContent = item.icon || '';

      const textWrap = document.createElement('span');
      textWrap.className = 'bre-slash-item__text';

      const labelEl = document.createElement('span');
      labelEl.className = 'bre-slash-item__label';
      labelEl.textContent = item.label;

      const descEl = document.createElement('span');
      descEl.className = 'bre-slash-item__desc';
      descEl.textContent = item.description || '';

      textWrap.appendChild(labelEl);
      textWrap.appendChild(descEl);
      el.appendChild(iconEl);
      el.appendChild(textWrap);

      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        _activeIndex = i;
        confirm();
      });

      menuEl.appendChild(el);
    });
  }

  function updateActiveClass() {
    const items = menuEl.querySelectorAll('.bre-slash-item');
    items.forEach((el, i) => {
      el.setAttribute('data-active', i === _activeIndex ? 'true' : 'false');
    });
    // Scroll active item into view
    const activeEl = items[_activeIndex];
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function show(anchorRect, items) {
    _items = items;
    _filtered = [...items];
    _activeIndex = 0;
    renderItems();

    // Position below anchor
    const menuHeight = 280;
    let top = anchorRect.bottom + window.scrollY;
    let left = anchorRect.left + window.scrollX;

    // Keep within viewport
    if (top + menuHeight > window.innerHeight + window.scrollY) {
      top = anchorRect.top + window.scrollY - menuHeight;
    }
    if (left + 260 > window.innerWidth) {
      left = window.innerWidth - 270;
    }

    menuEl.style.top = `${anchorRect.bottom}px`;
    menuEl.style.left = `${left}px`;
    menuEl.style.display = 'block';
  }

  function hide() {
    menuEl.style.display = 'none';
    _filtered = [];
    _activeIndex = 0;
  }

  function isVisible() {
    return menuEl.style.display !== 'none';
  }

  function filter(query) {
    const q = query.toLowerCase();
    _filtered = _items.filter(item =>
      item.label.toLowerCase().includes(q) ||
      (item.description && item.description.toLowerCase().includes(q))
    );
    _activeIndex = 0;
    renderItems();
  }

  function next() {
    if (_filtered.length === 0) return;
    _activeIndex = (_activeIndex + 1) % _filtered.length;
    updateActiveClass();
  }

  function prev() {
    if (_filtered.length === 0) return;
    _activeIndex = (_activeIndex - 1 + _filtered.length) % _filtered.length;
    updateActiveClass();
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
    menuEl.remove();
  }

  return { show, hide, isVisible, filter, next, prev, confirm, destroy };
}
