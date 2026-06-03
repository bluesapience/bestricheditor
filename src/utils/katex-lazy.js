/**
 * Single dynamic-import entry point for KaTeX.
 * Starts loading the moment any module imports this file.
 * All consumers share the same promise — katex is fetched exactly once.
 */
let _katex = null;

export const katexReady = import('katex').then(m => {
  _katex = m.default;
  return _katex;
});

/** Synchronous getter — returns the module or null if not yet resolved. */
export function getKaTeX() {
  return _katex;
}

/**
 * Inject the KaTeX stylesheet from jsDelivr once per page.
 * Consumers can prevent the CDN fetch by adding their own
 *   <link id="bre-katex-css" rel="stylesheet" href="/path/to/katex.min.css">
 * before the editor loads.
 */
export function ensureKaTeXStyles() {
  if (document.getElementById('bre-katex-css')) return;
  const link = document.createElement('link');
  link.id = 'bre-katex-css';
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css';
  document.head.appendChild(link);
}
