/**
 * Video block plugin — supports direct video files and YouTube/Vimeo embeds.
 * data: { src: string, caption?: string }
 *
 * Factory: createVideoPlugin(embedAllowlist) → plugin object
 * Registered by editor.js after opts are resolved.
 */
import { escapeHTML } from '../utils/dom.js';

/**
 * Try to extract a safe embed URL for known providers.
 * Returns null if src is not in the allowlist → fall back to <video>.
 */
function getEmbedUrl(src, embedAllowlist) {
  if (!src) return null;
  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, '');
    const allowed = (embedAllowlist || []).some(
      d => host === d || host.endsWith('.' + d)
    );
    if (!allowed) return null;

    // YouTube
    if (host === 'youtube.com' || host === 'youtu.be') {
      let id;
      if (host === 'youtu.be') {
        id = url.pathname.slice(1).split('?')[0];
      } else {
        id = url.searchParams.get('v');
      }
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
    }

    // Vimeo
    if (host === 'vimeo.com') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : null;
    }

    return null;
  } catch {
    return null;
  }
}

export function createVideoPlugin(embedAllowlist) {
  return {
    render(block) {
      const src = (block.data && block.data.src) || '';
      const caption = (block.data && block.data.caption) || '';

      const figure = document.createElement('figure');
      figure.className = 'bre-video-block';

      if (src) {
        const embedUrl = getEmbedUrl(src, embedAllowlist);
        if (embedUrl) {
          const iframe = document.createElement('iframe');
          iframe.className = 'bre-video-embed';
          iframe.setAttribute('src', embedUrl);
          iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
          iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
          iframe.setAttribute('loading', 'lazy');
          iframe.setAttribute('allowfullscreen', '');
          figure.appendChild(iframe);
        } else {
          const video = document.createElement('video');
          video.className = 'bre-video';
          video.setAttribute('controls', '');
          video.setAttribute('src', src);
          figure.appendChild(video);
        }
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'bre-video-placeholder';
        placeholder.textContent = 'Click to set video URL or paste a YouTube/Vimeo link';
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
      const embedUrl = getEmbedUrl(src, embedAllowlist);
      const mediaEl = embedUrl
        ? `<iframe src="${escapeHTML(embedUrl)}" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" allowfullscreen></iframe>`
        : `<video controls src="${escapeHTML(src)}"></video>`;
      return [
        '<figure>',
        mediaEl,
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
  };
}
