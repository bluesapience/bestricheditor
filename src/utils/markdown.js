/**
 * Internal Markdown parser + KaTeX renderer for BREM mode.
 * No external markdown library — hand-rolled to keep the bundle lean.
 *
 * Two outputs share one block tokenizer (`tokenizeMarkdown`):
 *   - parseMarkdown(md)     -> preview HTML string (KaTeX rendered, media figures)
 *   - markdownToBlocks(md)  -> BRE block objects (paragraph/heading/lists/...)
 *
 * Supported inline syntax: **bold**, *italic* or _italic_, ~~strike~~, `code`,
 * <u>underline</u>, <br>, [text](url "title"), ![alt](url "title"), $math$,
 * $$math$$ and backslash escapes (\*, \_, \$ ...).
 */
import { getKaTeX } from './katex-lazy.js';
import { sanitizeURL, sanitizeHTML } from './sanitize.js';
import { generateId } from './id.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Remove backslash escapes: `\*` -> `*`. */
export function unescapeMarkdown(str) {
  return str.replace(/\\([\\`*_{}[\]()#+\-.!|>$~<"])/g, '$1');
}

const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);

// Active embed allowlist for the current parse (null = YouTube/Vimeo defaults).
let _embedAllow = null;

/** Extract embed URL for YouTube / Vimeo, or null for other URLs. */
function getEmbedUrl(src) {
  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, '');
    if (_embedAllow && !_embedAllow.some(d => host === d || host.endsWith('.' + d))) return null;
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

/** Classify a media URL the same way the preview renderer does: 'image' | 'audio' | 'video'. */
export function detectMediaKind(src) {
  if (getEmbedUrl(src)) return 'video';
  const ext = src.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'image';
}

/**
 * Render a `![alt](url "title")` token as the right media element.
 * YouTube/Vimeo → iframe embed; audio/video extensions → <audio>/<video>;
 * everything else → <img>. Caption = title, falling back to alt.
 */
function renderMedia(alt, safeUrl, title) {
  const capText = title || alt;
  const cap = capText ? `<figcaption class="bre-media-caption">${escapeHTML(capText)}</figcaption>` : '';

  const embedUrl = getEmbedUrl(safeUrl);
  if (embedUrl) {
    return `<figure class="bre-video-block"><iframe class="bre-video-embed" src="${escapeHTML(embedUrl)}" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" allowfullscreen></iframe>${cap}</figure>`;
  }

  const kind = detectMediaKind(safeUrl);
  if (kind === 'audio') {
    return `<figure class="bre-audio-block"><audio class="bre-audio" controls src="${escapeHTML(safeUrl)}"></audio>${cap}</figure>`;
  }
  if (kind === 'video') {
    return `<figure class="bre-video-block"><video class="bre-video" controls src="${escapeHTML(safeUrl)}"></video>${cap}</figure>`;
  }
  return `<figure class="bre-image-block"><img class="bre-image" src="${escapeHTML(safeUrl)}" alt="${escapeHTML(alt)}" loading="lazy">${cap}</figure>`;
}

// ── Delimiter scanning (escape aware) ────────────────────────────────────────

/** Index of the next unescaped `ch` at or after `from`, or -1. */
function findChar(text, from, ch) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === ch) return i;
  }
  return -1;
}

/** Index of the next unescaped two-char sequence `seq` at or after `from`, or -1. */
function findSeq(text, from, seq) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === seq[0] && text[i + 1] === seq[1]) return i;
  }
  return -1;
}

/** Closing `)` of a link target, skipping `"quoted titles"`. */
function findCloseParen(text, from) {
  let inQuote = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === '"') inQuote = !inQuote;
    else if (c === ')' && !inQuote) return i;
  }
  return -1;
}

const isAlnum = (c) => c !== undefined && /[A-Za-z0-9]/.test(c);

/** Closing delimiter for italic, skipping double-delimiter sequences and escapes. */
function findItalicEnd(text, start, delim) {
  let i = start;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === delim) {
      if (text[i + 1] === delim) { i += 2; continue; }
      if (delim === '_' && isAlnum(text[i + 1])) { i++; continue; } // intra-word underscore
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Parse `[label](url "title")` / `![label](url "title")` starting at `i`
 * (pointing at `[` or `!`). Returns null when it isn't a well-formed token.
 */
function parseBracketed(text, i) {
  const isImage = text[i] === '!';
  const open = isImage ? i + 2 : i + 1;
  const close = findChar(text, open, ']');
  if (close === -1 || text[close + 1] !== '(') return null;
  const end = findCloseParen(text, close + 2);
  if (end === -1) return null;
  const inside = text.slice(close + 2, end);
  const m = inside.match(/^\s*(\S*?)(?:\s+"((?:[^"\\]|\\.)*)")?\s*$/);
  const url = unescapeMarkdown(m ? m[1] : inside.trim());
  const title = m && m[2] != null ? unescapeMarkdown(m[2]) : '';
  return { label: text.slice(open, close), url, title, end: end + 1, isImage };
}

// ── Inline Processing ─────────────────────────────────────────────────────────

/**
 * Convert inline markdown to HTML.
 * ctx.blocks = false (default): preview output, KaTeX rendered, media figures.
 * ctx.blocks = true: block-model output — plain inline HTML, formulas become
 *   <span data-bre-type="formula" data-bre-latex="…"> so they round-trip.
 * Everything else is HTML-escaped.
 */
function processInline(text, ctx = {}) {
  const blocksMode = !!ctx.blocks;
  let out = '';
  let i = 0;
  const len = text.length;

  const mathSpan = (tex) =>
    `<span data-bre-type="formula" data-bre-latex="${escapeHTML(tex)}">$${escapeHTML(tex)}$</span>`;

  while (i < len) {
    const ch = text[i];

    // ── Backslash escape
    if (ch === '\\' && i + 1 < len && '\\`*_{}[]()#+-.!|>$~<"'.includes(text[i + 1])) {
      out += escapeHTML(text[i + 1]);
      i += 2;
      continue;
    }

    // ── Block KaTeX: $$...$$
    if (ch === '$' && text[i + 1] === '$') {
      const end = text.indexOf('$$', i + 2);
      if (end !== -1) {
        const tex = text.slice(i + 2, end);
        if (blocksMode) {
          out += mathSpan(tex);
        } else {
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
        }
        i = end + 2;
        continue;
      }
    }

    // ── Inline KaTeX: $...$
    if (ch === '$') {
      const end = text.indexOf('$', i + 1);
      if (end !== -1 && end > i + 1) {
        const tex = text.slice(i + 1, end);
        // Only if single-line (no newlines) and non-empty
        if (!tex.includes('\n') && tex.trim().length > 0) {
          if (blocksMode) {
            out += mathSpan(tex);
            i = end + 1;
            continue;
          }
          const katex = getKaTeX();
          if (katex) {
            try {
              out += katex.renderToString(tex, { displayMode: false, throwOnError: true, output: 'html' });
            } catch {
              out += `<code>${escapeHTML(tex)}</code>`;
            }
          } else {
            out += `<code>${escapeHTML(tex)}</code>`;
          }
          i = end + 1;
          continue;
        }
      }
    }

    // ── Inline code: `...`
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        out += `<code>${escapeHTML(text.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }

    // ── Bold: **...**
    if (ch === '*' && text[i + 1] === '*') {
      const end = findSeq(text, i + 2, '**');
      if (end !== -1) {
        out += `<strong>${processInline(text.slice(i + 2, end), ctx)}</strong>`;
        i = end + 2;
        continue;
      }
    }

    // ── Strike: ~~...~~
    if (ch === '~' && text[i + 1] === '~') {
      const end = findSeq(text, i + 2, '~~');
      if (end !== -1) {
        out += `<del>${processInline(text.slice(i + 2, end), ctx)}</del>`;
        i = end + 2;
        continue;
      }
    }

    // ── Italic: *...* (careful not to match **)
    if (ch === '*' && text[i + 1] !== '*') {
      const end = findItalicEnd(text, i + 1, '*');
      if (end !== -1) {
        out += `<em>${processInline(text.slice(i + 1, end), ctx)}</em>`;
        i = end + 1;
        continue;
      }
    }

    // ── Italic: _..._ (not intra-word)
    if (ch === '_' && !isAlnum(text[i - 1])) {
      const end = findItalicEnd(text, i + 1, '_');
      if (end !== -1) {
        out += `<em>${processInline(text.slice(i + 1, end), ctx)}</em>`;
        i = end + 1;
        continue;
      }
    }

    // ── Underline / line break (the only raw HTML understood)
    if (ch === '<') {
      if (text.startsWith('<u>', i)) {
        const end = text.indexOf('</u>', i + 3);
        if (end !== -1) {
          out += `<u>${processInline(text.slice(i + 3, end), ctx)}</u>`;
          i = end + 4;
          continue;
        }
      }
      const br = /^<br\s*\/?>/i.exec(text.slice(i, i + 8));
      if (br) {
        out += '<br>';
        i += br[0].length;
        continue;
      }
    }

    // ── Image / Audio / Video: ![alt](url "title")
    if (ch === '!' && text[i + 1] === '[') {
      const tok = parseBracketed(text, i);
      if (tok) {
        const alt = unescapeMarkdown(tok.label);
        const safeUrl = sanitizeURL(tok.url);
        if (!safeUrl) {
          out += escapeHTML(alt);
        } else if (blocksMode) {
          out += tok.isImage && detectMediaKind(safeUrl) === 'image'
            ? `<img src="${escapeHTML(safeUrl)}" alt="${escapeHTML(alt)}">`
            : `<a href="${escapeHTML(safeUrl)}" rel="noopener noreferrer">${escapeHTML(alt || safeUrl)}</a>`;
        } else {
          out += renderMedia(alt, safeUrl, tok.title);
        }
        i = tok.end;
        continue;
      }
    }

    // ── Link: [text](url)
    if (ch === '[') {
      const tok = parseBracketed(text, i);
      if (tok) {
        const safeUrl = sanitizeURL(tok.url);
        const inner = processInline(tok.label, ctx);
        out += safeUrl
          ? `<a href="${escapeHTML(safeUrl)}" rel="noopener noreferrer">${inner}</a>`
          : inner;
        i = tok.end;
        continue;
      }
    }

    // ── Regular character — escape and append
    out += escapeHTML(ch);
    i++;
  }

  return out;
}

// ── Block tokenizer ───────────────────────────────────────────────────────────

const RE_HR = /^[-*_]{3,}$/;
const RE_UL = /^[-*]\s/;
const RE_OL = /^\d+\.\s/;

/**
 * Split a markdown string into block tokens.
 * Token shapes: { t: 'code', lang, code } | { t: 'hr' } | { t: 'heading', level, text }
 *   | { t: 'quote', text } | { t: 'ul'|'ol', items: string[] }
 *   | { t: 'table', rows: string[][] } | { t: 'p', text }
 * Inline text in tokens is raw markdown (not yet inline-parsed).
 */
function tokenizeMarkdown(text) {
  const tokens = [];
  if (!text || typeof text !== 'string') return tokens;

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  /** Split a pipe-table row on unescaped pipes. */
  const parseRow = (row) => {
    const cells = [];
    let cur = '';
    let body = row.trim();
    if (body.startsWith('|')) body = body.slice(1);
    for (let k = 0; k < body.length; k++) {
      if (body[k] === '\\' && body[k + 1] === '|') { cur += '\\|'; k++; continue; }
      if (body[k] === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += body[k];
    }
    if (cur.trim() !== '') cells.push(cur.trim()); // trailing cell without closing pipe
    return cells;
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── Code fence: ```lang ... ```
    if (line.trimStart().startsWith('```')) {
      const fenceMatch = line.match(/^\s*(`{3,})([\w-]*)/);
      const fenceMarker = fenceMatch ? fenceMatch[1] : '```';
      const lang = fenceMatch ? fenceMatch[2] : '';
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].trimStart().startsWith(fenceMarker)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      tokens.push({ t: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    // ── Divider: ---, ***, ___
    if (RE_HR.test(line.trim())) {
      tokens.push({ t: 'hr' });
      i++;
      continue;
    }

    // ── Heading: # to ######
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      tokens.push({ t: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
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
      tokens.push({ t: 'quote', text: bqLines.join(' ') });
      continue;
    }

    // ── Bulleted list: - or *
    if (RE_UL.test(line)) {
      const items = [];
      while (i < lines.length && RE_UL.test(lines[i])) {
        items.push(lines[i].replace(RE_UL, ''));
        i++;
      }
      tokens.push({ t: 'ul', items });
      continue;
    }

    // ── Numbered list: N. text
    if (RE_OL.test(line)) {
      const items = [];
      while (i < lines.length && RE_OL.test(lines[i])) {
        items.push(lines[i].replace(RE_OL, ''));
        i++;
      }
      tokens.push({ t: 'ol', items });
      continue;
    }

    // ── Pipe table: header row / separator row / body rows
    if (line.startsWith('|') && i + 1 < lines.length &&
        lines[i + 1].startsWith('|') && /-/.test(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const [headerRow, /* sep */, ...bodyRows] = tableLines;
      tokens.push({ t: 'table', rows: [parseRow(headerRow), ...bodyRows.map(parseRow)] });
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
      !RE_HR.test(lines[i].trim()) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !(lines[i].startsWith('> ') || lines[i] === '>') &&
      !RE_UL.test(lines[i]) &&
      !RE_OL.test(lines[i]) &&
      !lines[i].startsWith('|')
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) tokens.push({ t: 'p', text: paraLines.join(' ') });
  }

  return tokens;
}

// ── Preview HTML ──────────────────────────────────────────────────────────────

/**
 * Parse a markdown string into an HTML string (preview rendering).
 */
export function parseMarkdown(text, options) {
  const prev = _embedAllow;
  _embedAllow = (options && options.embedAllowlist) || null;
  try {
    return parseMarkdownInner(text);
  } finally {
    _embedAllow = prev;
  }
}

function parseMarkdownInner(text) {
  const out = [];
  for (const tok of tokenizeMarkdown(text)) {
    switch (tok.t) {
      case 'code': {
        const langAttr = tok.lang ? ` class="language-${escapeHTML(tok.lang)}"` : '';
        out.push(`<pre><code${langAttr}>${escapeHTML(tok.code)}</code></pre>`);
        break;
      }
      case 'hr':
        out.push('<hr>');
        break;
      case 'heading':
        out.push(`<h${tok.level}>${processInline(tok.text)}</h${tok.level}>`);
        break;
      case 'quote':
        out.push(`<blockquote>${processInline(tok.text)}</blockquote>`);
        break;
      case 'ul':
      case 'ol':
        out.push(`<${tok.t}>\n${tok.items.map(it => `<li>${processInline(it)}</li>`).join('\n')}\n</${tok.t}>`);
        break;
      case 'table': {
        const [headers, ...body] = tok.rows;
        const thead = `<thead><tr>${headers.map(h => `<th>${processInline(h)}</th>`).join('')}</tr></thead>`;
        const tbody = body.length > 0
          ? `<tbody>${body.map(r => `<tr>${r.map(c => `<td>${processInline(c)}</td>`).join('')}</tr>`).join('\n')}</tbody>`
          : '';
        out.push(`<div class="bre-table-wrapper"><table class="bre-table">\n${thead}\n${tbody}\n</table></div>`);
        break;
      }
      default:
        out.push(`<p>${processInline(tok.text)}</p>`);
    }
  }
  return out.join('\n');
}

// ── Markdown -> BRE blocks ────────────────────────────────────────────────────

let _textParser = null;
/** Plain text of an inline-markdown string (marks stripped). */
function inlineMarkdownToText(md) {
  const html = processInline(md, { blocks: true });
  if (!/[<&]/.test(html)) return html;
  if (!_textParser) _textParser = new DOMParser();
  return _textParser.parseFromString(`<body>${html}`, 'text/html').body.textContent || '';
}

/** Inline markdown -> sanitized inline HTML for a block's `html` field. */
function inlineHTML(md) {
  const html = processInline(md, { blocks: true });
  return /[<&]/.test(html) ? sanitizeHTML(html) : html;
}

const block = (type, data) => ({ id: generateId(), type, data });

/**
 * Parse markdown into BRE block objects so a BREM document can be loaded into
 * BRE/BREW (and vice versa via blocksToMarkdown).
 *
 * Produces: heading, paragraph, bulleted_list, numbered_list, quote, code,
 * divider, table, image/audio/video (standalone `![..](..)` lines) and
 * formula (a paragraph that is exactly one `$$..$$` or `$..$`). Inline marks
 * land in each block's `data.html`. Inline `$..$` inside prose is kept as a
 * `<span data-bre-type="formula" data-bre-latex>` so it serializes back.
 *
 * @param {string} md
 * @returns {Array<{id:string,type:string,data:object}>}
 */
export function markdownToBlocks(md) {
  const blocks = [];
  for (const tok of tokenizeMarkdown(md)) {
    switch (tok.t) {
      case 'code':
        blocks.push(block('code', { code: tok.code, language: tok.lang }));
        break;
      case 'hr':
        blocks.push(block('divider', {}));
        break;
      case 'heading':
        blocks.push(block('heading', { level: tok.level, html: inlineHTML(tok.text) }));
        break;
      case 'quote':
        blocks.push(block('quote', { html: inlineHTML(tok.text) }));
        break;
      case 'ul':
        for (const it of tok.items) blocks.push(block('bulleted_list', { html: inlineHTML(it) }));
        break;
      case 'ol':
        for (const it of tok.items) blocks.push(block('numbered_list', { html: inlineHTML(it) }));
        break;
      case 'table': {
        const width = Math.max(...tok.rows.map(r => r.length));
        const rows = tok.rows.map(r => {
          const cells = r.map(inlineMarkdownToText);
          while (cells.length < width) cells.push('');
          return cells;
        });
        blocks.push(block('table', { rows }));
        break;
      }
      default: {
        const text = tok.text.trim();
        // Standalone media line
        if (text.startsWith('![')) {
          const m = parseBracketed(text, 0);
          if (m && m.end === text.length) {
            const src = sanitizeURL(m.url);
            if (src) {
              const label = unescapeMarkdown(m.label);
              const kind = detectMediaKind(src);
              if (kind === 'image') {
                blocks.push(block('image', { src, alt: label, caption: m.title }));
              } else {
                blocks.push(block(kind, { src, caption: m.title || label }));
              }
              break;
            }
          }
        }
        // Standalone formula
        if (text.startsWith('$$') && text.endsWith('$$') && text.length > 4 &&
            text.indexOf('$$', 2) === text.length - 2) {
          blocks.push(block('formula', { latex: text.slice(2, -2).trim(), displayMode: true }));
          break;
        }
        if (text.startsWith('$') && text.endsWith('$') && text.length > 2 &&
            !text.slice(1, -1).includes('$') && !text.includes('\n')) {
          blocks.push(block('formula', { latex: text.slice(1, -1).trim(), displayMode: false }));
          break;
        }
        blocks.push(block('paragraph', { html: inlineHTML(text) }));
      }
    }
  }
  return blocks;
}
