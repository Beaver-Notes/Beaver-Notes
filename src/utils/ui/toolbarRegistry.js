/**
 * toolbarRegistry.js
 *
 * A lightweight singleton registry that lets plugins (or any module)
 * register additional toolbar items before the app mounts.
 *
 * Usage from a plugin:
 *
 *   import { toolbarRegistry } from '@/utils/toolbarRegistry';
 *
 *   toolbarRegistry.register({
 *     id: 'myPlugin:button',
 *     label: 'My Button',
 *     icon: 'riStarLine',
 *     group: 'plugins',          // can be any group string
 *     // component: MyComponent, // optional – if provided, NoteMenu renders it
 *                                //  instead of the built-in v-else-if branch
 *   });
 *
 * The toolbar reads `toolbarRegistry.all()` at computed time, so items
 * registered before the component mounts will appear automatically.
 */

/** @typedef {{ id: string, label: string, icon: string|null, group: string, isDivider?: boolean, component?: object }} ToolbarItemMeta */

const _items = [];

export const toolbarRegistry = {
  /**
   * Register a new toolbar item.
   * Safe to call multiple times (duplicate ids are ignored).
   * @param {ToolbarItemMeta} item
   */
  register(item) {
    if (!item?.id) throw new Error('[toolbarRegistry] item must have an id');
    if (_items.some((i) => i.id === item.id)) {
      console.warn(
        `[toolbarRegistry] "${item.id}" is already registered – skipping`
      );
      return;
    }
    _items.push(item);
  },

  /** Return a shallow copy of all registered items (built-ins + plugins). */
  all() {
    return [..._items];
  },

  /** Check if an id is registered. */
  has(id) {
    return _items.some((i) => i.id === id);
  },

  /** Get metadata for one item (used by the customizer). */
  get(id) {
    return _items.find((i) => i.id === id) ?? null;
  },
};

// ─── Built-in items ───────────────────────────────────────────────────────────
// Registered here so they share the same source-of-truth as plugin items.
// Plugins can call register() in their own setup files.

// defaultVisible: false  →  hidden for first-time users (fresh install).
// Reset always restores ALL items to visible regardless of defaultVisible.
// Omitting defaultVisible means shown by default.
const BUILTIN_ITEMS = [
  {
    id: 'paragraph',
    translationKey: 'paragraph',
    label: 'Paragraph',
    icon: 'riParagraph',
    group: 'text',
  },
  { id: 'headings',
    translationKey: 'headings', label: 'Headings', icon: 'riHeading', group: 'text' },
  { id: 'fontSize',
    translationKey: 'fontSize', label: 'Font Size', icon: 'riText', group: 'text' },
  {
    id: 'divider1',
    label: 'Divider',
    icon: null,
    group: 'divider',
    isDivider: true,
  },
  { id: 'bold',
    translationKey: 'bold', label: 'Bold', icon: 'riBold', group: 'formatting' },
  { id: 'italic',
    translationKey: 'italic', label: 'Italic', icon: 'riItalic', group: 'formatting' },
  {
    id: 'underline',
    translationKey: 'underline',
    label: 'Underline',
    icon: 'riUnderline',
    group: 'formatting',
  },
  {
    id: 'strikethrough',
    translationKey: 'strikethrough',
    label: 'Strikethrough',
    icon: 'riStrikethrough',
    group: 'formatting',
  },
  {
    id: 'inlineCode',
    translationKey: 'inlineCode',
    label: 'Inline Code',
    icon: 'riCodeLine',
    group: 'formatting',
  },
  {
    id: 'color',
    translationKey: 'textHighlight',
    label: 'Text & Highlight',
    icon: 'riFontColor',
    group: 'formatting',
  },
  {
    id: 'divider2',
    label: 'Divider',
    icon: null,
    group: 'divider',
    isDivider: true,
  },
  {
    id: 'blockquote',
    translationKey: 'blockQuote',
    label: 'Block Quote',
    icon: 'riDoubleQuotesR',
    group: 'blocks',
  },
  {
    id: 'codeBlock',
    translationKey: 'codeBlock',
    label: 'Code Block',
    icon: 'riCodeBoxLine',
    group: 'blocks',
    defaultVisible: false,
  },
  { id: 'lists',
    translationKey: 'lists', label: 'Lists', icon: 'riListOrdered', group: 'blocks' },
  {
    id: 'divider3',
    label: 'Divider',
    icon: null,
    group: 'divider',
    isDivider: true,
  },
  { id: 'image',
    translationKey: 'image', label: 'Image', icon: 'riImageLine', group: 'media' },
  {
    id: 'audio',
    translationKey: 'audioRecord',
    label: 'Audio / Record',
    icon: 'riMicLine',
    group: 'media',
  },
  { id: 'link',
    translationKey: 'link', label: 'Link', icon: 'riLink', group: 'media' },
  {
    id: 'file',
    translationKey: 'file',
    label: 'File',
    icon: 'riFile2Line',
    group: 'media',
  },
  { id: 'table',
    translationKey: 'table', label: 'Table', icon: 'riTableLine', group: 'media' },
  {
    id: 'draw',
    translationKey: 'draw',
    label: 'Draw',
    icon: 'riBrushLine',
    group: 'media',
    defaultVisible: true,
  },
  {
    id: 'video',
    translationKey: 'video',
    label: 'Video',
    icon: 'riMovieLine',
    group: 'media',
    defaultVisible: false,
  },
  {
    id: 'divider4',
    label: 'Divider',
    icon: null,
    group: 'divider',
    isDivider: true,
  },
  { id: 'share',
    translationKey: 'share', label: 'Share', icon: 'riShare2Line', group: 'actions' },
  {
    id: 'delete',
    translationKey: 'deleteNote',
    label: 'Delete Note',
    icon: 'riDeleteBin6Line',
    group: 'actions',
    defaultVisible: false,
  },
  {
    id: 'readerMode',
    translationKey: 'readerMode',
    label: 'Reader Mode',
    icon: 'riArticleLine',
    group: 'actions',
    defaultVisible: false,
  },
  {
    id: 'headingsTree',
    translationKey: 'headingsTree',
    label: 'Headings Tree',
    icon: 'riSearchLine',
    group: 'actions',
  },
];

BUILTIN_ITEMS.forEach((item) => toolbarRegistry.register(item));
