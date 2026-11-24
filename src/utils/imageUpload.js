/**
 * Shared image-upload helpers for BRE, BREW and BREM.
 *
 * The host supplies `uploadImage(file) => Promise<string>`; these helpers only
 * validate, call it, sanitize the URL it returns, and provide small UI plumbing
 * (file picker, drag-over marker). Files are never read or embedded.
 */
import { sanitizeURL } from './sanitize.js';
import { encodeUrl } from './blocksToMarkdown.js';

/** Image files from a FileList / array, in order. */
export function imageFiles(list) {
  return Array.from(list || []).filter((f) => f && typeof f.type === 'string' && f.type.startsWith('image/'));
}

/**
 * Image files to upload from a paste. Text wins: when the clipboard also carries text
 * (copying cells from Excel/Word puts a rendered picture next to the text), nothing is
 * uploaded and the normal paste runs. A bare image, or HTML that is only an <img>
 * (a copied web image), is uploaded.
 */
export function pastedImages(cd) {
  const imgs = imageFiles(cd && cd.files);
  if (!imgs.length) return [];
  const html = cd.getData('text/html') || '';
  const text = cd.getData('text/plain') || '';
  return text.trim() || html.replace(/<[^>]*>/g, '').trim() ? [] : imgs;
}

/** One file per action: the first file and everything else. */
export function splitFirst(files) {
  return { first: files.length ? files[0] : null, extra: files.slice(1) };
}

/**
 * Validate + upload one file. Resolves a sanitized URL, otherwise throws an
 * Error whose message comes from `messages` (or from the hook itself).
 */
export async function uploadOne(file, { hook, maxSize, messages }) {
  if (typeof hook !== 'function') throw new Error(messages.uploadNotConfigured);
  if (typeof maxSize === 'number' && maxSize > 0 && file.size > maxSize) throw new Error(messages.uploadTooLarge);
  const url = await hook(file); // `async` turns a synchronous throw into a rejection
  if (typeof url !== 'string') throw new Error(messages.uploadFailed);
  const safe = sanitizeURL(url);
  if (!safe || /[\u0000-\u001f\u007f]/.test(safe)) throw new Error(messages.invalidUrl);
  return safe;
}

/** File name without its final extension. */
export function altFromFile(file) {
  return String((file && file.name) || '').replace(/\.[^./\\]+$/, '');
}

/** Markdown image with a safely escaped alt and an encoded URL. */
export function markdownImage(alt, url) {
  // Backticks can't be escaped reliably (inline-code pairing runs first), so the alt uses an apostrophe.
  const text = String(alt).replace(/\r\n|[\r\n]/g, ' ').replace(/`/g, "'").replace(/[\\[\]*_$<]/g, '\\$&');
  return `![${text}](${encodeUrl(url)})`;
}

/** Open a single-select image file picker; resolves [] when cancelled. */
export function pickImageFiles(parent) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    parent.appendChild(input);
    input.click();
  });
}

const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));

/**
 * Set `data-bre-dragover="true"` on `root` while files are dragged over it.
 * Returns a disposer.
 */
export function trackFileDrag(root, isEnabled) {
  const set = (e) => { if (isEnabled() && hasFiles(e)) root.setAttribute('data-bre-dragover', 'true'); };
  const clear = () => root.removeAttribute('data-bre-dragover');
  const leave = (e) => {
    if (e.relatedTarget && root.contains(e.relatedTarget)) return;
    // Some browsers report a null relatedTarget when crossing child elements: use the pointer position.
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      const r = root.getBoundingClientRect();
      if (e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) return;
    }
    clear();
  };
  root.addEventListener('dragenter', set);
  root.addEventListener('dragover', set);
  root.addEventListener('dragleave', leave);
  root.addEventListener('drop', clear);
  return () => {
    root.removeEventListener('dragenter', set);
    root.removeEventListener('dragover', set);
    root.removeEventListener('dragleave', leave);
    root.removeEventListener('drop', clear);
    clear();
  };
}
