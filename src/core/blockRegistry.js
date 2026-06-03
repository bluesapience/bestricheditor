/**
 * Block type registry for Best Rich Editor.
 * Plugins register themselves here; the editor and renderer look them up by type.
 */

const _registry = new Map();

export const blockRegistry = {
  /**
   * Register a block type plugin.
   * @param {string} type - Block type identifier (e.g. 'paragraph')
   * @param {object} plugin - Plugin object with render, toHTML, validate methods
   */
  register(type, plugin) {
    if (_registry.has(type)) {
      console.warn(`[bre] blockRegistry: overwriting existing type "${type}"`);
    }
    _registry.set(type, plugin);
  },

  /**
   * Get a plugin by type. Throws if not found.
   */
  get(type) {
    const plugin = _registry.get(type);
    if (!plugin) {
      throw new Error(`[bre] blockRegistry: unknown block type "${type}"`);
    }
    return plugin;
  },

  /**
   * Check if a type is registered.
   */
  has(type) {
    return _registry.has(type);
  },

  /**
   * Return all registered [type, plugin] pairs.
   */
  all() {
    return Array.from(_registry.entries());
  },

  /**
   * Register a block type plugin without the overwrite warning.
   * Use for intentional re-registration (e.g. video with a per-instance allowlist).
   */
  registerSilent(type, plugin) {
    _registry.set(type, plugin);
  },

  /**
   * Return the capabilities of a registered block type.
   * Falls back to a safe default if the plugin has no capabilities defined.
   */
  getCapabilities(type) {
    const plugin = _registry.get(type);
    if (plugin && plugin.capabilities) return plugin.capabilities;
    return { inline: false, marks: [], links: false };
  },
};
