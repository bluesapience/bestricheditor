/**
 * Document schema versioning + migrations.
 *
 * Pure: never mutates the caller's object. Returns a new document whose blocks
 * array is shared with the input when no block needs to change (cheap).
 *
 * v0 (no/invalid version) → v1: ensures document id/timestamps and that every
 * block has a string id and an object `data`.
 */
import { generateId } from '../utils/id.js';

export const CURRENT_VERSION = 1;

const migrations = [
  // index i migrates version i → i + 1
  function v0to1(doc) {
    const now = Date.now();
    let changed = false;
    const blocks = doc.blocks.map((b) => {
      if (b && typeof b.id === 'string' && b.data && typeof b.data === 'object') return b;
      changed = true;
      return {
        ...b,
        id: b && typeof b.id === 'string' ? b.id : generateId(),
        data: b && b.data && typeof b.data === 'object' ? b.data : {},
      };
    });
    return {
      ...doc,
      id: typeof doc.id === 'string' ? doc.id : generateId(),
      created: typeof doc.created === 'number' ? doc.created : now,
      updated: typeof doc.updated === 'number' ? doc.updated : now,
      version: 1,
      blocks: changed ? blocks : doc.blocks,
    };
  },
];

/**
 * @param {object} input  a Document (any supported version)
 * @returns {object} Document at CURRENT_VERSION
 */
export function migrateDocument(input) {
  let doc = input;
  let v = Number.isInteger(doc.version) && doc.version >= 0 ? doc.version : 0;

  if (v > CURRENT_VERSION) {
    // Newer than we understand: load best-effort, never downgrade-write.
    console.warn(
      `[bre] document version ${v} is newer than supported (${CURRENT_VERSION}); loading best-effort.`
    );
    return { ...doc };
  }
  if (!Array.isArray(doc.blocks)) doc = { ...doc, blocks: [] };

  while (v < CURRENT_VERSION) {
    doc = migrations[v](doc);
    v = doc.version;
  }
  return doc === input ? { ...doc } : doc;
}
