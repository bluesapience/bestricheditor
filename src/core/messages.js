/**
 * UI strings for BRE. Every user-facing string goes through here so hosts can
 * localise via `options.messages` (partial override).
 */
export const DEFAULT_MESSAGES = {
  editorLabel: 'Rich text editor',
  placeholder: 'Type something, or press / for commands',
  paragraphHint: 'Type / for commands',
  heading: 'Heading {n}',
  listItem: 'List item',
  quote: 'Quote…',
  code: '// Code…',
  caption: 'Caption…',
  tableHeader: 'Header',
  tableCell: 'Cell',
  addRow: '+ Row',
  delRow: '− Row',
  addCol: '+ Col',
  delCol: '− Col',
  formulaEmpty: 'Click to add formula…',
  imageEmpty: 'Click to set image URL',
  audioEmpty: 'Click to set audio URL',
  videoEmpty: 'Click to set video URL or paste a YouTube/Vimeo link',
  slashNoResults: 'No results',
  slashLabel: 'Insert block',
  dragHandle: 'Drag to move block',
  blockMoved: 'Block moved to position {n} of {total}',
  uploading: 'Uploading image…',
  uploadFailed: 'Image upload failed',
  textFormatting: 'Text formatting',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  inlineCode: 'Inline code',
  link: 'Link (Cmd+K)',
  promptUrl: 'Enter URL:',
  promptFormula: 'Enter LaTeX formula (e.g. E = mc^2):',
  promptEditFormula: 'Edit LaTeX formula:',
  promptImageUrl: 'Enter image URL:',
  promptAudioUrl: 'Enter audio URL:',
  promptVideoUrl: 'Enter video URL or YouTube/Vimeo link:',
  invalidUrl: 'Invalid or unsafe URL.',
  // Slash menu items
  slash: {
    paragraph: ['Text', 'Start writing with plain text'],
    h1: ['Heading 1', 'Large section heading'],
    h2: ['Heading 2', 'Medium section heading'],
    h3: ['Heading 3', 'Small section heading'],
    bulleted_list: ['Bulleted List', 'Create a simple bulleted list'],
    numbered_list: ['Numbered List', 'Create a numbered list'],
    quote: ['Quote', 'Capture a quote or callout'],
    divider: ['Divider', 'Insert a horizontal divider'],
    code: ['Code', 'Write a code snippet'],
    columns2: ['Columns 2', 'Two-column layout'],
    columns3: ['Columns 3', 'Three-column layout'],
    columns4: ['Columns 4', 'Four-column layout (2×2 on medium screens)'],
    formula: ['Formula', 'Insert a KaTeX math formula'],
    table: ['Table', 'Insert a table'],
    image: ['Image', 'Insert an image from a URL or upload'],
    audio: ['Audio', 'Insert an audio file from URL'],
    video: ['Video', 'Insert a video or YouTube/Vimeo embed'],
  },
};

/** Merge a partial override over the defaults (shallow + `slash` one level). */
export function resolveMessages(partial) {
  if (!partial) return DEFAULT_MESSAGES;
  return {
    ...DEFAULT_MESSAGES,
    ...partial,
    slash: { ...DEFAULT_MESSAGES.slash, ...(partial.slash || {}) },
  };
}

/** Replace {n}-style tokens. */
export function fmt(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
}
