import './bre.base.css';   // structure (also published alone as bre-base.css)
import './bre.theme.css';  // default look for the editor's own UI; zero specificity, variable-driven
import { blockRegistry } from './core/blockRegistry.js';
export { createEditor } from './core/editor.js';
export { transforms } from './core/transforms.js';
export { migrateDocument, CURRENT_VERSION } from './core/migrate.js';
export { DEFAULT_MESSAGES } from './core/messages.js';

/**
 * Register a custom block type for all editors on the page.
 * See README → "Custom blocks".
 */
export function registerBlock(def) {
  return blockRegistry.registerCustom(def);
}
