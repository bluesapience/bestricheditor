// Shared jsdom bootstrap for tests. Import this FIRST in every test file.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window;
for (const k of [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DocumentFragment', 'Event',
  'CustomEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  'DOMParser', 'Range', 'Selection', 'NodeFilter', 'HTMLTextAreaElement', 'KeyboardEvent', 'FocusEvent', 'File', 'DataTransfer',
]) {
  if (w[k] !== undefined) {
    try { Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true }); } catch { /* ignore */ }
  }
}
globalThis.window = w;
globalThis.document = w.document;
// jsdom lacks execCommand / scrollIntoView
w.document.execCommand = () => false;
w.Element.prototype.scrollIntoView = function () {};
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}
