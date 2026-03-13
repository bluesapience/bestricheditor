/**
 * Image block plugin.
 * data: { src: string, alt?: string, caption?: string }
 */
import { blockRegistry } from '../core/blockRegistry.js';
import { escapeHTML } from '../utils/dom.js';

blockRegistry.register('image', {
  render(block) {
    const src = (block.data && block.data.src) || '';
    const alt = (block.data && block.data.alt) || '';
    const caption = (block.data && block.data.caption) || '';

    const figure = document.createElement('figure');
    figure.className = 'bre-image-block';

    if (src) {
      const img = document.createElement('img');
      img.className = 'bre-image';
      img.setAttribute('src', src);
      img.setAttribute('alt', alt);
      img.setAttribute('loading', 'lazy');
      figure.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'bre-image-placeholder';
      placeholder.textContent = 'Click to set image URL';
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
    const alt = escapeHTML((block.data && block.data.alt) || '');
    const caption = escapeHTML((block.data && block.data.caption) || '');
    return [
      '<figure>',
      `<img src="${escapeHTML(src)}" alt="${alt}" loading="lazy">`,
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
