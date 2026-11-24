/**
 * Hygiene for blocks arriving from untrusted document JSON (setJSON):
 *  - ids end up in attributes/selectors → keep only a conservative charset
 *  - media `src` must pass the URL policy (no javascript:/data:)
 */
import { generateId } from './id.js';
import { sanitizeURL } from './sanitize.js';

const SAFE_ID = /^[\w.:-]{1,128}$/;
const MEDIA = new Set(['image', 'audio', 'video']);

/** Returns the same block when nothing needs changing (keeps identity/sharing). */
export function cleanBlock(b) {
  let out = b;
  if (typeof out.id !== 'string' || !SAFE_ID.test(out.id)) out = { ...out, id: generateId() };
  if (MEDIA.has(out.type) && out.data && typeof out.data.src === 'string' && out.data.src !== '') {
    const safe = sanitizeURL(out.data.src);
    if (safe !== out.data.src) out = { ...out, data: { ...out.data, src: safe } };
  }
  return out;
}
