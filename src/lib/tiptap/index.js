import { Editor } from '@tiptap/vue-3';
import heading from './exts/headings';
import Video from './exts/video-block';
import Document from '@tiptap/extension-document';
import StarterKit from '@tiptap/starter-kit';
import { Highlight } from './exts/highlight';
import Typography from '@tiptap/extension-typography';
import Link from '@tiptap/extension-link';
import Code from '@tiptap/extension-code';
import markdownEngine from './exts/markdown-engine';
import { Paste } from './exts/markdown-engine/paste';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import LabelSuggestion from './exts/label-suggestion';
import MathInline from './exts/math-inline';
import MathBlock from './exts/math-block';
import MermaidBlock from './exts/mermaid-block';
import TextDirection from 'tiptap-text-direction';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import CodeBlock from './exts/code-block';
import LinkNote from './exts/link-note';
import FileEmbed from './exts/file-block';
import Audio from './exts/audio-block';
import Text from '@tiptap/extension-text';
import CollapseHeading from './exts/collapse-heading';
import SearchAndReplace from '@sereneinserenade/tiptap-search-and-replace';
import Dropcursor from '@tiptap/extension-dropcursor';
import {
  blueCallout,
  yellowCallout,
  redCallout,
  purpleCallout,
  blackCallout,
  greenCallout,
} from './exts/callouts';
import { LiteralTab } from './exts/literal-tab';
import Image from './exts/image';
import { TableKit, TableHandleExtension } from './exts/table/index.js';
import {
  Column,
  ColumnContainer,
  MultiColumn,
  ColumnDropCursor,
} from './exts/multi-column';
import Footnote from './exts/footnote-block/footnote';
import Footnotes from './exts/footnote-block/footnotes';
import FootnoteReference from './exts/footnote-block/reference';
import Commands from './exts/commands';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import FontSize from 'tiptap-extension-font-size';
import TextAlign from '@tiptap/extension-text-align';
import Paper from './exts/paper-block';
import { dropFile } from './exts/drop-file';
import { getTranslations } from '@/utils/getTranslations';
import { getSettingSync } from '@/composable/settings';
const translations = getTranslations();

const directionPreference = getSettingSync('directionPreference');

const defaultDirection = directionPreference === 'rtl' ? 'rtl' : 'ltr';

function createBaseExtensions({ yjs = false } = {}) {
  return [
    LabelSuggestion,
    StarterKit.configure({
      heading: false,
      text: false,
      codeBlock: false,
      code: false,
      link: false,
      document: false,
      paste: false,
      dropcursor: false,
      // Collaboration extension adds yUndoPlugin — skip built-in history to
      // avoid the "not compatible with undo-redo" console warning.
      history: !yjs,
    }),
    Paste,
    Document.extend({
      content: 'block+ (footnotes)?',
      allowGapCursor: true,
    }),
    Highlight.extend({ priority: 1000 }).configure({
      multicolor: true,
    }),
    Typography,
    LiteralTab,
    Color,
    blueCallout,
    yellowCallout,
    Text,
    redCallout,
    purpleCallout,
    blackCallout,
    greenCallout,
    LinkNote,
    FileEmbed,
    ColumnContainer,
    Column,
    MultiColumn,
    Dropcursor.configure({
      color: 'hsl(var(--twc-primary) / 0.5)',
      width: 3,
    }),
    ColumnDropCursor,
    Footnotes,
    FootnoteReference,
    Footnote,
    TaskList,
    TableKit.configure({
      table: {
        resizable: true,
        cellMinWidth: 80,
        handleWidth: 5,
        cellHeight: 44,
        lastColumnResizable: true,
      },
    }),
    TableHandleExtension,
    TaskItem.configure({
      nested: true,
    }),
    CodeBlock,
    Video,
    MathInline,
    MermaidBlock,
    FontSize,
    MathBlock,
    Subscript.extend({
      addKeyboardShortcuts() {
        return {
          'Alt-,': () => this.editor.commands.toggleSubscript(),
        };
      },
    }),
    Superscript,
    TextDirection.configure({
      defaultDirection: defaultDirection,
    }),
    Image,
    Audio,
    SearchAndReplace.configure(),
    TextStyle,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    markdownEngine,
    Paper,
    Placeholder.configure({
      placeholder: translations.editor.tiptapPlaceholder,
    }),
    Code.configure({ HTMLAttributes: { class: 'inline-code' } }),
    Link.extend({
      inclusive: false,
      addKeyboardShortcuts() {
        return {
          'Mod-k': () =>
            this.editor.chain().focus().toggleLink({ href: '' }).run(),
        };
      },
    }).configure({
      openOnClick: false,
      protocols: ['http', 'https', 'mailto', 'note'],
      HTMLAttributes: {
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
        'tiptap-url': 'true',
      },
    }),
  ];
}

const extensions = createBaseExtensions();

export { extensions, createBaseExtensions, CollapseHeading, heading, dropFile, Commands };

export default function ({ extensions: optsExts, ...opts }) {
  const instance = new Editor({
    ...opts,
    extensions: [...extensions, ...(optsExts || [])],
  });

  return instance;
}
