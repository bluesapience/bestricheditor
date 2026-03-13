/**
 * Audio block plugin.
 * data: { src: string, caption?: string }
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';

blockRegistry.register('audio', {
  render(block) {
    const src = (block.data && block.data.src) || '';
    const caption = (block.data && block.data.caption) || '';

    const figure = document.createElement('figure');
    figure.className = 'bre-audio-block';

    if (src) {
      const audio = document.createElement('audio');
      audio.className = 'bre-audio';
      audio.setAttribute('controls', '');
      audio.setAttribute('src', src);
      figure.appendChild(audio);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'bre-audio-placeholder';
      placeholder.textContent = 'Click to set audio URL';
      figure.appendChild(placeholder);
    }

    const figcaption = document.createElement('figcaption');
    figcaption.className = 'bre-media-caption';
    figcaption.setAttribute('contenteditable', 'true');
    figcaption.setAttribute('data-bre-field', 'caption');
    figcaption.setAttribute('data-bre-placeholder', 'Caption…');
    figcaption.textContent = caption;
    figure.appendChild(figcaption);

    return figure;
  },

  toHTML(block) {
    const src = (block.data && block.data.src) || '';
    if (!src) return '';
    const caption = escapeHTML((block.data && block.data.caption) || '');
    return [
      '<figure>',
      `<audio controls src="${escapeHTML(src)}"></audio>`,
      caption ? `<figcaption>${caption}</figcaption>` : '',
      '</figure>',
    ].filter(Boolean).join('\n');
  },

  validate(block) {
    return block.data && typeof block.data.src === 'string';
  },

  capabilities: {
    inline: false,
    marks: [],
    links: false,
  },
});
