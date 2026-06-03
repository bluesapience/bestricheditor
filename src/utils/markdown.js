/**
 * Internal Markdown parser + KaTeX renderer for BREM mode.
 * No external markdown library — hand-rolled to keep the bundle lean.
 */
import { getKaTeX } from './katex-lazy.js';
import { sanitizeURL } from './sanitize.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);

/** Extract embed URL for YouTube / Vimeo, or null for other URLs. */
function getEmbedUrl(src) {
  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'youtu.be') {
      const id = host === 'youtu.be'
        ? url.pathname.slice(1).split('?')[0]
        : url.searchParams.get('v');
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
    }
    if (host === 'vimeo.com') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : null;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Render a `![alt](url)` token as the right media element.
 * YouTube/Vimeo → iframe embed; audio/video extensions → <audio>/<video>;
 * everything else → <img>.
 */
function renderMedia(alt, safeUrl) {
  const cap = alt ? `<figcaption class="bre-media-caption">${escapeHTML(alt)}</figcaption>` : '';

  const embedUrl = getEmbedUrl(safeUrl);
  if (embedUrl) {
    return `<figure class="bre-video-block"><iframe class="bre-video-embed" src="${escapeHTML(embedUrl)}" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" allowfullscreen></iframe>${cap}</figure>`;
  }

  const ext = safeUrl.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
  if (AUDIO_EXTS.has(ext)) {
    return `<figure class="bre-audio-block"><audio class="bre-audio" controls src="${escapeHTML(safeUrl)}"></audio>${cap}</figure>`;
  }
  if (VIDEO_EXTS.has(ext)) {
    return `<figure class="bre-video-block"><video class="bre-video" controls src="${escapeHTML(safeUrl)}"></video>${cap}</figure>`;
  }
  // Default: image
  return `<figure class="bre-image-block"><img class="bre-image" src="${escapeHTML(safeUrl)}" alt="${escapeHTML(alt)}" loading="lazy">${cap}</figure>`;
}

// ── Inline Processing ─────────────────────────────────────────────────────────

/**
 * Scan text character by character and convert inline markdown to HTML.
 * Handles: $$...$$ block KaTeX, $...$ inline KaTeX, `code`, **bold**,
 * *italic*, _italic_, [text](url) links. Everything else is HTML-escaped.
 */
function processInline(text) {
  let out = '';
  let i = 0;
  const len = text.length;

  while (i < len) {
    // ── Block KaTeX: $$...$$
    if (text[i] === '$' && text[i + 1] === '$') {
      const end = text.indexOf('$$', i + 2);
      if (end !== -1) {
        const tex = text.slice(i + 2, end);
        const katex = getKaTeX();
        if (katex) {
          try {
            const rendered = katex.renderToString(tex, { displayMode: true, throwOnError: true, output: 'html' });
            out += `<span class="bre-katex-block">${rendered}</span>`;
          } catch {
            out += `<code>${escapeHTML(tex)}</code>`;
          }
        } else {
          out += `<code>${escapeHTML(tex)}</code>`;
        }
        i = end + 2;
        continue;
      }
    }

    // ── Inline KaTeX: $...$
    if (text[i] === '$') {
      const end = text.indexOf('$', i + 1);
      if (end !== -1 && end > i + 1) {
        const tex = text.slice(i + 1, end);
        // Only if single-line (no newlines) and non-empty
        if (!tex.includes('\n') && tex.trim().length > 0) {
          const katex = getKaTeX();
          if (katex) {
            try {
              out += katex.renderToString(tex, { displayMode: false, throwOnError: true, output: 'html' });
              i = end + 1;
              continue;
            } catch {
              out += `<code>${escapeHTML(tex)}</code>`;
              i = end + 1;
              continue;
            }
          } else {
            out += `<code>${escapeHTML(tex)}</code>`;
            i = end + 1;
            continue;
          }
        }
      }
    }

    // ── Inline code: `...`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        const code = text.slice(i + 1, end);
        out += `<code>${escapeHTML(code)}</code>`;
        i = end + 1;
        continue;
      }
    }

    // ── Bold: **...**
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        const inner = text.slice(i + 2, end);
        out += `<strong>${processInline(inner)}</strong>`;
        i = end + 2;
        continue;
      }
    }

    // ── Italic: *...* (careful not to match **)
    if (text[i] === '*' && text[i + 1] !== '*') {
      const end = findItalicEnd(text, i + 1, '*');
      if (end !== -1) {
        const inner = text.slice(i + 1, end);
        out += `<em>${processInline(inner)}</em>`;
        i = end + 1;
        continue;
      }
    }

    // ── Italic: _..._
    if (text[i] === '_') {
      const end = findItalicEnd(text, i + 1, '_');
      if (end !== -1) {
        const inner = text.slice(i + 1, end);
        out += `<em>${processInline(inner)}</em>`;
        i = end + 1;
        continue;
      }
    }

    // ── Image / Audio / Video: ![alt](url)
    if (text[i] === '!' && text[i + 1] === '[') {
      const closeBracket = text.indexOf(']', i + 2);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const alt = text.slice(i + 2, closeBracket);
          const rawUrl = text.slice(closeBracket + 2, closeParen);
          const safeUrl = sanitizeURL(rawUrl);
          out += safeUrl ? renderMedia(alt, safeUrl) : escapeHTML(alt);
          i = closeParen + 1;
          continue;
        }
      }
    }

    // ── Link: [text](url)
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const linkText = text.slice(i + 1, closeBracket);
          const rawUrl = text.slice(closeBracket + 2, closeParen);
          const safeUrl = sanitizeURL(rawUrl);
          if (safeUrl) {
            out += `<a href="${escapeHTML(safeUrl)}" rel="noopener noreferrer">${escapeHTML(linkText)}</a>`;
          } else {
            out += escapeHTML(linkText);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // ── Regular character — escape and append
    out += escapeHTML(text[i]);
    i++;
  }

  return out;
}

/**
 * Find the closing delimiter for italic, skipping double-delimiter sequences.
 */
function findItalicEnd(text, start, delim) {
  let i = start;
  while (i < text.length) {
    if (text[i] === delim) {
      // Make sure it's not ** or __
      if (text[i + 1] === delim) {
        i += 2; // skip **
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

// ── Block Processing ──────────────────────────────────────────────────────────

/**
 * Parse a markdown string into an HTML string.
 * Processes block-level elements in order, walking lines.
 */
export function parseMarkdown(text) {
  if (!text || typeof text !== 'string') return '';

  const lines = text.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Code fence: ```lang ... ```
    if (line.trimStart().startsWith('```')) {
      const fenceMatch = line.match(/^(`{3,})([\w-]*)/);
      const fenceMarker = fenceMatch ? fenceMatch[1] : '```';
      const lang = fenceMatch ? fenceMatch[2] : '';
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].trimStart().startsWith(fenceMarker)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const langAttr = lang ? ` class="language-${escapeHTML(lang)}"` : '';
      out.push(`<pre><code${langAttr}>${escapeHTML(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // ── Divider: ---, ***, ___
    if (/^[-*_]{3,}$/.test(line.trim())) {
      out.push('<hr>');
      i++;
      continue;
    }

    // ── Heading: # to ######
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      out.push(`<h${level}>${processInline(content)}</h${level}>`);
      i++;
      continue;
    }

    // ── Blockquote: > lines
    if (line.startsWith('> ') || line === '>') {
      const bqLines = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        bqLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${processInline(bqLines.join(' '))}</blockquote>`);
      continue;
    }

    // ── Bulleted list: - or *
    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s/, ''));
        i++;
      }
      const liHTML = items.map(item => `<li>${processInline(item)}</li>`).join('\n');
      out.push(`<ul>\n${liHTML}\n</ul>`);
      continue;
    }

    // ── Numbered list: N. text
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      const liHTML = items.map(item => `<li>${processInline(item)}</li>`).join('\n');
      out.push(`<ol>\n${liHTML}\n</ol>`);
      continue;
    }

    // ── Pipe table: | header | ... / | --- | ... / | cell | ...
    // Lookahead: only commit if the next line is a separator row (contains dashes).
    if (line.startsWith('|') && i + 1 < lines.length &&
        lines[i + 1].startsWith('|') && /[-]/.test(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const parseRow = row => row.split('|').slice(1, -1).map(c => c.trim());
      const [headerRow, /* sep */, ...bodyRows] = tableLines;
      const headers = parseRow(headerRow);
      const thead = `<thead><tr>${headers.map(h => `<th>${processInline(h)}</th>`).join('')}</tr></thead>`;
      const tbody = bodyRows.length > 0
        ? `<tbody>${bodyRows.map(r => `<tr>${parseRow(r).map(c => `<td>${processInline(c)}</td>`).join('')}</tr>`).join('\n')}</tbody>`
        : '';
      out.push(`<div class="bre-table-wrapper"><table class="bre-table">\n${thead}\n${tbody}\n</table></div>`);
      continue;
    }

    // ── Empty line: skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ── Paragraph: consecutive non-special lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !/^[-*_]{3,}$/.test(lines[i].trim()) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !(lines[i].startsWith('> ') || lines[i] === '>') &&
      !/^[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !lines[i].startsWith('|')
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      out.push(`<p>${processInline(paraLines.join(' '))}</p>`);
    }
  }

  return out.join('\n');
}
