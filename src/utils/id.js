/**
 * Collision-safe ID generator for blocks and documents.
 * Uses 64 bits of crypto randomness (pooled for speed) → 13 base-36 chars.
 * Falls back to Math.random only where Web Crypto is unavailable.
 */
const POOL_SIZE = 256; // uint32 values per refill (128 ids)
let pool = null;
let poolIdx = POOL_SIZE;

function nextUint32() {
  if (poolIdx >= POOL_SIZE) {
    if (!pool) pool = new Uint32Array(POOL_SIZE);
    globalThis.crypto.getRandomValues(pool);
    poolIdx = 0;
  }
  return pool[poolIdx++];
}

const hasCrypto =
  typeof globalThis.crypto !== 'undefined' &&
  typeof globalThis.crypto.getRandomValues === 'function';

export function generateId() {
  if (hasCrypto) {
    // Two 32-bit words → ~64 bits. Prefix 'b' keeps it a valid CSS/attr token.
    return 'b' + nextUint32().toString(36) + nextUint32().toString(36);
  }
  return (
    'b' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}
