/** Plugin toolbar registry: register items before mount, toolbar reads all() at computed time. */

/** @typedef {{ id: string, label: string, icon: string|null, group: string, isDivider?: boolean, component?: object }} ToolbarItemMeta */

const _items = [];

export const toolbarRegistry = {
  /** Register item; duplicate ids ignored. */
  register(item) {
    if (!item?.id) throw new Error('[toolbarRegistry] item must have an id');
    if (_items.some((i) => i.id === item.id)) {
      console.warn(
        `[toolbarRegistry] "${item.id}" is already registered: skipping`
      );
      return;
    }
    _items.push(item);
  },

  /** Shallow copy of all items (built-ins plus plugins). */
  all() {
    return [..._items];
  },

  /** Check if an id is registered. */
  has(id) {
    return _items.some((i) => i.id === id);
  },

  /** Get metadata for one item (customizer). */
  get(id) {
    return _items.find((i) => i.id === id) ?? null;
  },
};

// Built-ins share source of truth with plugin items.

// No defaultVisible means shown; false hides for fresh installs, reset restores all visible.
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
];

BUILTIN_ITEMS.forEach((item) => toolbarRegistry.register(item));
