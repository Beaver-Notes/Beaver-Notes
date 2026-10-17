import { Editor } from '@tiptap/vue-3';
import heading from './exts/headings';
import Video from './exts/video-block';
import Document from '@tiptap/extension-document';
import StarterKit from '@tiptap/starter-kit';
import { Highlight } from './exts/highlight';
import Typography from '@tiptap/extension-typography';
import Link from '@tiptap/extension-link';
import { registerCustomProtocol } from 'linkifyjs';

['http', 'https', 'mailto', 'note'].forEach((scheme) =>
  registerCustomProtocol(scheme)
);
import Code from '@tiptap/extension-code';
import markdownEngine from './exts/markdown-engine';
import { Paste } from './exts/markdown-engine/paste';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import LabelSuggestion from './exts/label-suggestion';
import UserMention from './exts/user-mention';
import { CommentExtension } from '@sereneinserenade/tiptap-comment-extension';
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
import { CharacterCount } from '@tiptap/extensions';
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
import YUndo from './exts/y-undo';
import { getTranslations } from '@/utils/i18n/getTranslations';
import { getSettingSync } from '@/lib/settings';
const translations = getTranslations();

function getDefaultDirection() {
  return getSettingSync('directionPreference') === 'rtl' ? 'rtl' : 'ltr';
}

function createBaseExtensions({ yjs = false, direction = null } = {}) {
  return [
    LabelSuggestion,
    UserMention,
    StarterKit.configure({
      heading: false,
      text: false,
      codeBlock: false,
      code: false,
      link: false,
      document: false,
      dropcursor: false,
      undoRedo: !yjs,
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
      types: ['heading', 'paragraph', 'blockquote', 'listItem', 'codeBlock'],
      // 'auto' (from the note's own dir field) lets the extension detect
      // direction per block from the text itself, which is what a note in a
      // different script than the UI needs. getDefaultDirection() stays as the
      // fallback for editors built without a note.
      defaultDirection: direction || getDefaultDirection(),
    }),
    Image,
    Audio,
    SearchAndReplace.configure(),
    TextStyle,
    CharacterCount,
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
      onCreate() {},
      onDestroy() {},
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
    ...(yjs ? [YUndo] : []),
  ];
}

const extensions = createBaseExtensions();
const yjsExtensions = createBaseExtensions({ yjs: true });

// Comment anchors ride in the doc as a `comment` mark that only NoteEditor
// registers (it needs `onCommentActivated`). Snapshot capture parses the same
// JSON through generateHTML, so without the mark here the capture is dropped
// with "There is no mark type comment in this schema". Not part of `extensions`
// on purpose: a second registration would duplicate the extension name.
// The rendered class matches NoteEditor's config; styles are in its global block.
const snapshotExtensions = [
  ...extensions,
  CommentExtension.configure({ HTMLAttributes: { class: 'comment-highlight' } }),
];

export { extensions, yjsExtensions, snapshotExtensions, createBaseExtensions, CollapseHeading, heading, dropFile, Commands };

export default function ({ extensions: optsExts, ...opts }) {
  const instance = new Editor({
    ...opts,
    // The app ships its own Paste + TextDirection; drop tiptap's core
    // duplicates (they'd otherwise collide by name).
    enableCoreExtensions: { paste: false, textDirection: false },
    extensions: [...extensions, ...(optsExts || [])],
  });

  return instance;
}
