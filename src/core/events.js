/**
 * Simple EventEmitter for internal editor events.
 */
export class EventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event. Returns unsubscribe function.
   */
  on(event, fn) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  /**
   * Unsubscribe a listener.
   */
  off(event, fn) {
    const set = this._listeners.get(event);
    if (set) set.delete(fn);
  }

  /** True if at least one listener is registered for the event. */
  has(event) {
    const set = this._listeners.get(event);
    return !!(set && set.size);
  }

  /** Remove every listener (used on destroy). */
  clear() {
    this._listeners.clear();
  }

  /**
   * Emit an event with optional payload.
   */
  emit(event, payload) {
    const set = this._listeners.get(event);
    if (set) {
      // Copy: a handler may unsubscribe itself while we iterate. A throwing
      // handler must not break the editor or the other handlers.
      for (const fn of Array.from(set)) {
        try { fn(payload); } catch (err) { console.error('[bre] event handler error:', err); }
      }
    }
  }
}
