/**
 * Block type registry for Best Rich Editor.
 * Plugins register themselves here; the editor and renderer look them up by type.
 *
 * Plugin interface (internal):
 *   render(block, ctx) -> HTMLElement
 *   toHTML(block, ctx) -> string
 *   validate(block)    -> boolean
 *   capabilities?      -> { inline, marks, links }
 */

const _registry = new Map();
/** @type {Map<string, object>} custom (user-registered) block definitions */
const _customs = new Map();

export const blockRegistry = {
  register(type, plugin) {
    if (_registry.has(type)) {
      console.warn(`[bre] blockRegistry: overwriting existing type "${type}"`);
    }
    _registry.set(type, plugin);
  },

  /** Register without the overwrite warning (intentional re-registration). */
  registerSilent(type, plugin) {
    _registry.set(type, plugin);
  },

  get(type) {
    const plugin = _registry.get(type);
    if (!plugin) {
      throw new Error(`[bre] blockRegistry: unknown block type "${type}"`);
    }
    return plugin;
  },

  has(type) {
    return _registry.has(type);
  },

  all() {
    return Array.from(_registry.entries());
  },

  getCapabilities(type) {
    const plugin = _registry.get(type);
    if (plugin && plugin.capabilities) return plugin.capabilities;
    return { inline: false, marks: [], links: false };
  },

  /**
   * Register a public custom block.
   *
   * def: {
   *   type, render(data, ctx) -> Element, serialize?(el) -> data,
   *   toHTML(data) -> string, fromHTML?(el) -> data | null, validate?(data),
   *   slashMenu?: { label, icon?, description?, keywords? }, defaultData?, capabilities?
   * }
   * ctx given to render: { blockId, readOnly, messages, update(data) }
   */
  registerCustom(def) {
    if (!def || typeof def.type !== 'string' || !def.type) {
      throw new Error('[bre] registerBlock: "type" is required');
    }
    if (typeof def.render !== 'function' || typeof def.toHTML !== 'function') {
      throw new Error('[bre] registerBlock: "render" and "toHTML" are required');
    }
    if (_registry.has(def.type) && !_customs.has(def.type)) {
      throw new Error(`[bre] registerBlock: "${def.type}" is a built-in block type`);
    }
    const plugin = {
      custom: true,
      def,
      render(block, ctx) {
        const el = def.render(block.data || {}, {
          blockId: block.id,
          readOnly: ctx.isReadOnly(),
          messages: ctx.messages,
          update: (data) => ctx.updateBlockData(block.id, data),
        });
        el.setAttribute('data-bre-custom', def.type);
        return el;
      },
      toHTML(block) {
        return def.toHTML(block.data || {});
      },
      validate(block) {
        return def.validate ? !!def.validate(block.data || {}) : true;
      },
      capabilities: def.capabilities || { inline: false, marks: [], links: false },
    };
    _registry.set(def.type, plugin);
    _customs.set(def.type, plugin);
    return plugin;
  },

  customs() {
    return Array.from(_customs.values());
  },
};
