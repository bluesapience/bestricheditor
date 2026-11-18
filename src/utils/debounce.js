/**
 * Returns a debounced version of fn that fires after delay ms of inactivity.
 * The returned function has `.cancel()` (drop a pending call) and
 * `.flush()` (run a pending call now).
 */
export function debounce(fn, delay) {
  let timer = null;
  let lastArgs = null;
  const debounced = (...args) => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, delay);
  };
  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  debounced.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fn(...lastArgs);
  };
  return debounced;
}
