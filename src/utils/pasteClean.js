/**
 * Clean clipboard HTML from Word / Google Docs / browsers before sanitizing.
 *
 * DOM-API only (DOMParser on a detached document; nothing touches live nodes).
 * The result is NOT a security boundary — always run it through sanitizeHTML.
 *
 *  - extracts the <!--StartFragment--> region, drops head/meta/style/script/comments
 *  - unwraps Google Docs' <b id="docs-internal-guid-…" style="font-weight:normal">
 *    (never treated as bold) and any b/strong with font-weight normal
 *  - converts bold/italic/underline/strike inline styles into <strong>/<em>/<u>/<s>
 *  - unwraps spans/fonts and Office namespaced tags (<o:p>, <w:…>)
 *  - Word `MsoListParagraph*` pseudo lists -> real <ul>/<ol> (flat, no nesting)
 *  - unwraps Google redirect links, drops non-href anchors
 *  - strips every attribute except a small structural whitelist
 */
import { sanitizeURL } from './sanitize.js';

const ATTR_WHITELIST = {
  A: ['href', 'title'],
  IMG: ['src', 'alt', 'title'],
  TD: ['colspan', 'rowspan'],
  TH: ['colspan', 'rowspan'],
  OL: ['start'],
  CODE: ['class'],
  PRE: ['class'],
};

const DROP_TAGS = new Set(['META', 'STYLE', 'SCRIPT', 'LINK', 'TITLE', 'HEAD', 'XML', 'COLGROUP', 'COL', 'NOSCRIPT', 'TEMPLATE']);

function parseStyle(str) {
  const out = {};
  if (!str) return out;
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim().toLowerCase();
  }
  return out;
}

function isBoldWeight(v) {
  if (!v) return false;
  if (v === 'bold' || v === 'bolder') return true;
  const n = parseInt(v, 10);
  return !isNaN(n) && n >= 600;
}

function unwrap(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function wrapChildren(el, tag, doc) {
  const w = doc.createElement(tag);
  while (el.firstChild) w.appendChild(el.firstChild);
  el.appendChild(w);
}

/** Word list paragraphs -> <ul>/<ol>. Must run before attributes are stripped. */
function convertWordLists(doc) {
  const paras = Array.from(doc.querySelectorAll('p')).filter(p =>
    /^MsoListParagraph/i.test(p.getAttribute('class') || '') ||
    /mso-list:\s*l\d/i.test(p.getAttribute('style') || ''));
  const handled = new Set();
  for (const p of paras) {
    if (handled.has(p) || !p.parentNode) continue;
    // Collect the run of adjacent list paragraphs sharing a parent
    const run = [];
    let cur = p;
    while (cur && paras.includes(cur)) {
      run.push(cur);
      handled.add(cur);
      cur = cur.nextElementSibling;
    }
    let list = null;
    let listTag = null;
    for (const para of run) {
      let marker = '';
      for (const ign of Array.from(para.querySelectorAll('[style*="mso-list"]'))) {
        if (/mso-list:\s*ignore/i.test(ign.getAttribute('style') || '')) {
          marker = ign.textContent || '';
          ign.remove();
        }
      }
      if (!marker) {
        // Marker may be a bare leading text node like "1." or a bullet char
        const m = /^\s*([•·o§▪◦-]|\(?\d+[.)]|[a-zA-Z][.)]|[ivxlcdm]+[.)])[\s ]+/.exec(para.textContent || '');
        if (m) marker = m[1];
      }
      const ordered = /^\(?[0-9a-zA-Z]+[.)]$/.test(marker.trim()) && !/^[o·•§▪◦-]$/.test(marker.trim());
      const tag = ordered ? 'ol' : 'ul';
      if (!list || listTag !== tag) {
        list = doc.createElement(tag);
        listTag = tag;
        para.parentNode.insertBefore(list, para);
      }
      const li = doc.createElement('li');
      while (para.firstChild) li.appendChild(para.firstChild);
      list.appendChild(li);
      para.remove();
    }
  }
}

function googleRedirect(href) {
  try {
    const u = new URL(href);
    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/url') {
      return u.searchParams.get('q') || u.searchParams.get('url') || href;
    }
  } catch { /* relative or invalid */ }
  return href;
}

/**
 * @param {string} html raw text/html from the clipboard
 * @returns {string} cleaned HTML (still needs sanitizeHTML)
 */
export function cleanPastedHTML(html) {
  if (typeof html !== 'string' || !html) return '';

  // Windows clipboard wraps the real content in fragment markers
  const s = html.indexOf('<!--StartFragment-->');
  const e = html.indexOf('<!--EndFragment-->');
  if (s !== -1) html = html.slice(s + 20, e > s ? e : undefined);

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  if (!body) return '';

  // Comments (incl. Word conditional comments)
  const walker = doc.createTreeWalker(body, 128 /* SHOW_COMMENT */);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach(c => c.remove());

  convertWordLists(doc);

  for (const el of Array.from(body.querySelectorAll('*'))) {
    if (!el.parentNode) continue; // removed with an ancestor
    const tag = el.nodeName.toUpperCase();

    if (DROP_TAGS.has(tag)) { el.remove(); continue; }

    // Office namespaced tags: <o:p>&nbsp;</o:p>, <w:sdt> ...
    if (tag.includes(':')) {
      if (!(el.textContent || '').replace(/[\s ]/g, '')) el.remove(); else unwrap(el);
      continue;
    }

    if (tag === 'BR' && /Apple-interchange-newline/.test(el.getAttribute('class') || '')) { el.remove(); continue; }

    const style = parseStyle(el.getAttribute('style'));

    // Google Docs wrapper / explicit non-bold b|strong
    if ((tag === 'B' || tag === 'STRONG') &&
        (/^docs-internal-guid/.test(el.id || '') || style['font-weight'] === 'normal' || style['font-weight'] === '400')) {
      unwrap(el);
      continue;
    }

    // Inline style -> semantic tags
    if (el.hasAttribute('style') && !/^H[1-6]$|^T[HD]$/.test(tag)) {
      const bold = isBoldWeight(style['font-weight']);
      const italic = style['font-style'] === 'italic' || style['font-style'] === 'oblique';
      const deco = style['text-decoration'] || style['text-decoration-line'] || '';
      const under = deco.includes('underline') && tag !== 'A';
      const strike = deco.includes('line-through');
      const va = style['vertical-align'];
      if (el.firstChild) {
        if (strike) wrapChildren(el, 's', doc);
        if (under) wrapChildren(el, 'u', doc);
        if (va === 'super') wrapChildren(el, 'sup', doc);
        else if (va === 'sub') wrapChildren(el, 'sub', doc);
        if (italic && tag !== 'EM' && tag !== 'I') wrapChildren(el, 'em', doc);
        if (bold && tag !== 'B' && tag !== 'STRONG') wrapChildren(el, 'strong', doc);
      }
    }

    if (tag === 'SPAN' || tag === 'FONT') { unwrap(el); continue; }

    if (tag === 'IMG') {
      const src = sanitizeURL(el.getAttribute('src') || '');
      if (!src) { el.remove(); continue; }
      el.setAttribute('src', src);
    }

    if (tag === 'A') {
      const href = el.getAttribute('href');
      const safe = href ? sanitizeURL(googleRedirect(href)) : '';
      if (!safe) { unwrap(el); continue; }
      el.setAttribute('href', safe);
    }

    // Attribute whitelist
    const allow = ATTR_WHITELIST[tag] || [];
    for (const a of Array.from(el.attributes)) {
      if (!allow.includes(a.name)) el.removeAttribute(a.name);
    }
    if ((tag === 'CODE' || tag === 'PRE') && el.hasAttribute('class') && !/^language-[\w-]+$/.test(el.getAttribute('class'))) {
      el.removeAttribute('class');
    }
  }

  // Normalize b/i -> strong/em (after Docs wrapper handling)
  for (const el of Array.from(body.querySelectorAll('b, i'))) {
    const n = doc.createElement(el.nodeName === 'B' ? 'strong' : 'em');
    while (el.firstChild) n.appendChild(el.firstChild);
    el.replaceWith(n);
  }

  // Collapse source line-wrapping whitespace (not inside <pre>)
  const tw = doc.createTreeWalker(body, 4 /* SHOW_TEXT */);
  const texts = [];
  while (tw.nextNode()) texts.push(tw.currentNode);
  for (const t of texts) {
    if (t.parentNode && t.parentNode.closest && t.parentNode.closest('pre')) continue;
    t.nodeValue = t.nodeValue.replace(/\s*[\r\n]+\s*/g, ' ');
  }

  // Drop empty spacer paragraphs (Word `<p>&nbsp;</p>`)
  for (const p of Array.from(body.querySelectorAll('p'))) {
    if (!(p.textContent || '').replace(/[\s ]/g, '') && !p.querySelector('img,br,hr,table')) p.remove();
  }

  return body.innerHTML;
}
