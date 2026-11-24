/** Best Rich Editor (BRE) — public type definitions. */

// ---------------------------------------------------------------- Data model

export interface InlineData {
  /** Sanitized inline HTML (preferred). */
  html?: string;
  /** Plain text (legacy / convenience). */
  text?: string;
}

export interface ParagraphData extends InlineData {}
export interface QuoteData extends InlineData {}
export interface BulletedListData extends InlineData {}
export interface NumberedListData extends InlineData {}
export interface HeadingData extends InlineData {
  level: 1 | 2 | 3 | 4 | 5 | 6;
}
export interface DividerData {}
export interface CodeData {
  language?: string;
  code: string;
}
export interface FormulaData {
  latex: string;
  displayMode: boolean;
}
export interface TableData {
  /** First row is the header unless `hasHeader` is false. */
  rows: string[][];
  /** Render the first row as a header. Omitted means true. */
  hasHeader?: boolean;
}
export interface ImageData {
  src: string;
  alt?: string;
  caption?: string;
}
export interface AudioData {
  src: string;
  alt?: string;
  caption?: string;
}
export interface VideoData {
  src: string;
  alt?: string;
  caption?: string;
}
export interface ColumnsData {
  columns: Block[][];
}
export interface MarkdownData {
  markdown: string;
}

export interface BuiltinBlockDataMap {
  paragraph: ParagraphData;
  heading: HeadingData;
  quote: QuoteData;
  bulleted_list: BulletedListData;
  numbered_list: NumberedListData;
  divider: DividerData;
  code: CodeData;
  formula: FormulaData;
  table: TableData;
  image: ImageData;
  audio: AudioData;
  video: VideoData;
  columns: ColumnsData;
  markdown: MarkdownData;
}

export type BuiltinBlockType = keyof BuiltinBlockDataMap;

export type BuiltinBlock = {
  [K in BuiltinBlockType]: { id: string; type: K; data: BuiltinBlockDataMap[K]; children?: Block[] };
}[BuiltinBlockType];

/** A block registered through `registerBlock`. */
export interface CustomBlock {
  id: string;
  /** Any string that is not a built-in block type. */
  type: string;
  data: Record<string, unknown>;
  children?: Block[];
}

export type Block = BuiltinBlock | CustomBlock;

export interface Document {
  id: string;
  version: number;
  /** Unix ms. */
  created: number;
  /** Unix ms. */
  updated: number;
  blocks: Block[];
}

// ------------------------------------------------------------ Custom blocks

export interface BlockContext {
  blockId: string;
  readOnly: boolean;
  /** Effective UI strings (defaults merged with `options.messages`). */
  messages: Readonly<Record<string, unknown>>;
  /** Merge new data into this block and notify the editor (no re-render). */
  update(data: Record<string, unknown>): void;
}

export interface BlockCapabilities {
  inline?: boolean;
  marks?: string[];
  links?: boolean;
}

export interface SlashMenuEntry {
  label: string;
  icon?: string;
  description?: string;
  keywords?: string[];
}

export interface BlockDefinition<TData extends Record<string, unknown> = Record<string, unknown>> {
  type: string;
  render(data: TData, ctx: BlockContext): HTMLElement;
  /**
   * Optional. Read the current data back out of the rendered element; called on
   * `input` events inside the block. Alternatively call `ctx.update(data)`.
   */
  serialize?(el: HTMLElement): TData;
  /** Data for a block created from the slash menu. */
  defaultData?: TData;
  /** Must return trusted/sanitized HTML. */
  toHTML(data: TData): string;
  /** Return block data if this element should become this block when parsing HTML. */
  fromHTML?(el: HTMLElement): TData | null;
  validate?(data: TData): boolean;
  slashMenu?: SlashMenuEntry;
  capabilities?: BlockCapabilities;
}

// ------------------------------------------------------------------ Options

export type EditorMode = 'BRE' | 'BREM' | 'BREW';
export type EditorEventName = 'ready' | 'change' | 'focus' | 'blur' | 'selectionchange' | 'error';
export type TextDirection = 'ltr' | 'rtl' | 'auto';

/** Overridable UI strings. Keys are stable identifiers; unknown keys are ignored. */
export type Messages = Partial<Record<string, string>>;

export interface EditorOptionsBase {
  /** Debounced callback fired on content change. */
  onChange?: (doc: Document) => void;
  onReady?: (editor: Editor) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionChange?: (info: SelectionInfo) => void;
  /** Upload failures, invalid URLs, etc. */
  onError?: (info: EditorErrorInfo) => void;
  /** Domains allowed as iframe embeds. Default: youtube.com, youtu.be, vimeo.com. */
  embedAllowlist?: string[];
  /** 'auto' (default) virtualizes documents above `virtualizeThreshold` blocks; true/false force it. BRE mode only. */
  virtualize?: 'auto' | boolean;
  /** Block count above which 'auto' virtualization turns on. Default 300. */
  virtualizeThreshold?: number;
  /**
   * Replace the built-in inline input dialog (URL / formula entry). Return the
   * string (or null to cancel); may be async. BRE mode only.
   */
  prompt?: (message: string, defaultValue: string) => string | null | Promise<string | null>;
  readOnly?: boolean;
  placeholder?: string;
  /** Upload hook for pasted/dropped/picked images; resolve with the final URL. */
  uploadImage?: (file: File) => Promise<string>;
  /** Opt-in URL of a KaTeX stylesheet to inject. Nothing is injected by default. */
  katexCssUrl?: string;
  messages?: Messages;
  dir?: TextDirection;
}

export interface BREOptions extends EditorOptionsBase {
  mode?: 'BRE';
}
export interface BREMOptions extends EditorOptionsBase {
  mode: 'BREM';
}
export interface BREWOptions extends EditorOptionsBase {
  mode: 'BREW';
}
export type EditorOptions = BREOptions | BREMOptions | BREWOptions;

// ------------------------------------------------------------------- Editor

export interface SelectionInfo {
  /** Block holding the selection (BRE), otherwise null. */
  blockId: string | null;
  collapsed: boolean;
}

export interface EditorErrorInfo {
  type: 'upload' | 'invalid-url' | string;
  error: Error;
  file?: File;
}

export type EditorEventHandler = () => void;
export type EditorChangeHandler = (doc: Document) => void;

/**
 * Event payloads. 'change' is debounced (300 ms) and fires for user edits only —
 * never for programmatic setJSON()/setHTML().
 */
export interface EditorEventMap {
  ready: (editor: Editor) => void;
  change: EditorChangeHandler;
  focus: EditorEventHandler;
  blur: EditorEventHandler;
  selectionchange: (info: SelectionInfo) => void;
  error: (info: EditorErrorInfo) => void;
}

interface EditorBase {
  /**
   * BRE/BREW: the block document. BREM: a single 'markdown' block by default;
   * pass `{ as: 'blocks' }` to get the markdown parsed into real blocks.
   */
  getJSON(options?: { as?: 'blocks' | 'markdown' }): Document;
  setJSON(doc: Document): void;
  /** Sanitized HTML string. */
  getHTML(): string;
  setHTML(html: string): void;
  destroy(): void;
  setReadOnly(readOnly: boolean): void;
  isReadOnly(): boolean;
  focus(): void;
  blur(): void;
  isEmpty(): boolean;
  /** Subscribe; returns an unsubscribe function. */
  on<E extends EditorEventName>(event: E, handler: EditorEventMap[E]): () => void;
  off<E extends EditorEventName>(event: E, handler: EditorEventMap[E]): void;
}

export interface Editor extends EditorBase {
  /** Register a custom block type (global to the page; BRE mode). */
  registerBlock<TData extends Record<string, unknown>>(def: BlockDefinition<TData>): void;
}

/** Current document schema version produced by getJSON(). */
export const CURRENT_VERSION: number;
/** Migrate a document of any supported version to the current schema (pure). */
export function migrateDocument(doc: Partial<Document> & { blocks: unknown[] }): Document;
/** Default English UI strings. */
export const DEFAULT_MESSAGES: Readonly<Record<string, unknown>>;

// -------------------------------------------------------------------- API

export function createEditor(container: HTMLElement, options?: BREOptions): Editor;
export function createEditor(container: HTMLElement, options: BREMOptions): Editor;
export function createEditor(container: HTMLElement, options: BREWOptions): Editor;
export function createEditor(container: HTMLElement, options?: EditorOptions): Editor;

/** Register a custom block type globally (available to every BRE-mode editor). */
export function registerBlock<TData extends Record<string, unknown>>(def: BlockDefinition<TData>): void;

export type TransformStep<P = unknown, C = unknown> = (payload: P, ctx: C) => P | undefined;

export interface Transforms {
  register<P = unknown, C = unknown>(pipeline: string, step: TransformStep<P, C>, options?: { order?: number }): void;
  run<P = unknown, C = unknown>(pipeline: string, payload: P, ctx?: C): P;
  has(pipeline: string): boolean;
  clear(pipeline: string): void;
}

export const transforms: Transforms;
