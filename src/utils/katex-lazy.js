/**
 * Single entry point for KaTeX (lazy).
 *
 * ESM build : `import('katex')` — katex is an external dependency, so the
 *             consumer's bundler dedupes/splits it.
 * UMD build : the ESM branch is stripped at build time and replaced by an
 *             on-demand <script> loader for `bre.katex.umd.js`, resolved
 *             relative to the core UMD script URL. Override with
 *             `window.BRE_KATEX_URL = '/path/bre.katex.umd.js'`, or opt out
 *             with `window.BRE_KATEX_URL = false` (formulas then render as
 *             plain source text) — or call `setKaTeXUrl()`.
 *
 * All consumers share one promise — katex is fetched exactly once, and only
 * when first needed (`loadKaTeX()` / `katexReady.then`). `katexReady` resolves to the katex module, or `null` if it failed to load.
 */
let _katex = null;
let _cssUrl = null;
let _scriptUrl; // UMD only; undefined = auto-detect

/* @bre-umd-start
const _selfSrc = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';

function loadKaTeXScript() {
  return new Promise((resolve) => {
    const g = typeof window !== 'undefined' ? window : globalThis;
    // typeof checks: window.BRE_KATEX_URL / __BRE_KATEX__ can be DOM-clobbered by an
    // element with a matching id/name, which must never become a script URL or module.
    const isKatex = (k) => !!k && typeof k.renderToString === 'function';
    if (isKatex(g.__BRE_KATEX__)) return resolve(g.__BRE_KATEX__);
    const raw = _scriptUrl !== undefined ? _scriptUrl : g.BRE_KATEX_URL;
    if (raw === false || typeof document === 'undefined') return resolve(null);
    let url = typeof raw === 'string' ? raw : '';
    if (!url) {
      if (!_selfSrc) return resolve(null);
      url = _selfSrc.replace(/[^/]*(\?.*)?$/, 'bre.katex.umd.js');
    }
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve(isKatex(g.__BRE_KATEX__) ? g.__BRE_KATEX__ : null);
    s.onerror = () => { console.warn('[bre] Could not load KaTeX from ' + url); resolve(null); };
    document.head.appendChild(s);
  });
}
@bre-umd-end */

let _promise = null;

/** Start (once) loading KaTeX. Resolves to the module, or null on failure/opt-out. */
export function loadKaTeX() {
  if (!_promise) {
    _promise = (
      /* @bre-esm-start */
      import('katex').then(m => m.default || m)
      /* @bre-esm-end */
      /* @bre-umd-start
      Promise.resolve().then(loadKaTeXScript)
      @bre-umd-end */
    ).then(
      (k) => { _katex = k; return k; },
      (err) => { console.warn('[bre] KaTeX failed to load', err); return null; },
    );
  }
  return _promise;
}

/**
 * Thenable that triggers loading on first `.then()` — nothing is fetched until
 * a formula is actually rendered, so users without math never download KaTeX.
 */
export const katexReady = {
  then(onOk, onErr) { return loadKaTeX().then(onOk, onErr); },
};

/** Synchronous getter — returns the module or null if not yet resolved. */
export function getKaTeX() {
  return _katex;
}

/** UMD only: set/override the URL of bre.katex.umd.js (false = disable). Must run before first use. */
export function setKaTeXUrl(url) {
  _scriptUrl = url;
}

/**
 * Opt-in KaTeX stylesheet URL (options.katexCssUrl). No stylesheet is ever
 * injected unless this is set — import 'bestricheditor/katex.css' yourself otherwise.
 */
export function setKaTeXCssUrl(url) {
  _cssUrl = url || null;
}

/** Inject the configured KaTeX stylesheet once per page. No-op without setKaTeXCssUrl(). */
export function ensureKaTeXStyles() {
  if (!_cssUrl || typeof document === 'undefined') return;
  if (document.getElementById('bre-katex-css')) return;
  const link = document.createElement('link');
  link.id = 'bre-katex-css';
  link.rel = 'stylesheet';
  link.href = _cssUrl;
  document.head.appendChild(link);
}
