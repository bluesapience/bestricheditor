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

  /**
   * Emit an event with optional payload.
   */
  emit(event, payload) {
    const set = this._listeners.get(event);
    if (set) {
      for (const fn of set) {
        fn(payload);
      }
    }
  }
}
