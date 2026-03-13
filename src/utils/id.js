/** Generate a short random ID for blocks and documents. */
export function generateId() {
  return Math.random().toString(36).slice(2, 10);
}
