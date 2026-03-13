/**
 * Transformation pipeline registry.
 * Usage:
 *   transforms.register('paste', fn, { order: 20 });
 *   transforms.run('paste', payload, ctx);
 */

const pipelines = new Map();

export const transforms = {
  /**
   * Register a step in a pipeline.
   * @param {string} pipelineName
   * @param {Function} fn  - (payload, ctx) => newPayload | undefined
   * @param {{ order?: number }} [options]
   */
  register(pipelineName, fn, { order = 50 } = {}) {
    if (!pipelines.has(pipelineName)) {
      pipelines.set(pipelineName, []);
    }
    const steps = pipelines.get(pipelineName);
    steps.push({ fn, order });
    // Keep sorted by order ascending
    steps.sort((a, b) => a.order - b.order);
  },

  /**
   * Run all steps in a pipeline.
   * Each step receives (payload, ctx) and returns a new payload, or undefined to keep current.
   * @param {string} pipelineName
   * @param {*} payload
   * @param {object} [ctx]
   * @returns {*} final payload
   */
  run(pipelineName, payload, ctx = {}) {
    const steps = pipelines.get(pipelineName);
    if (!steps || steps.length === 0) return payload;
    let current = payload;
    for (const { fn } of steps) {
      const result = fn(current, ctx);
      if (result !== undefined) {
        current = result;
      }
    }
    return current;
  },

  /**
   * Returns true if the pipeline has at least one registered step.
   * @param {string} pipelineName
   * @returns {boolean}
   */
  has(pipelineName) {
    const steps = pipelines.get(pipelineName);
    return !!(steps && steps.length > 0);
  },

  /**
   * Remove all steps from a pipeline (for testing).
   * @param {string} pipelineName
   */
  clear(pipelineName) {
    pipelines.delete(pipelineName);
  },
};
