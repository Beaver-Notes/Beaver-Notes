import { Editor } from '@tiptap/vue-3';
import heading from './exts/headings';
import Video from './exts/video-block';
import Document from '@tiptap/extension-document';
import StarterKit from '@tiptap/starter-kit';
import Highlight from './exts/highlight';
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
import Paper from './exts/paper-block';
import CodeBlock from './exts/code-block';
import LinkNote from './exts/link-note';
import FileEmbed from './exts/file-block';
import Audio from './exts/audio-block';
import Text from '@tiptap/extension-text';
import Iframe from './exts/embed-block/iframe';
import CollapseHeading from './exts/collapse-heading';
import SearchAndReplace from '@sereneinserenade/tiptap-search-and-replace';
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
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import Footnote from './exts/footnote-block/footnote';
import Footnotes from './exts/footnote-block/footnotes';
import FootnoteReference from './exts/footnote-block/reference';
import Commands from './exts/commands';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import FontSize from 'tiptap-extension-font-size';
import { dropFile } from './exts/drop-file';
import { getTranslations } from '@/utils/getTranslations';
import { getSettingSync } from '@/composable/settings';
const translations = getTranslations();

const directionPreference = getSettingSync('directionPreference');

const defaultDirection = directionPreference === 'rtl' ? 'rtl' : 'ltr';

const extensions = [
  LabelSuggestion,
  StarterKit.configure({
    heading: false,
    text: false,
    codeBlock: false,
    code: false,
    link: false,
    document: false,
    paste: false,
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
  Paper,
  Footnotes,
  FootnoteReference,
  Footnote,
  TaskList,
  Table.configure({
    resizable: true,
  }),
  TableRow,
  TableHeader,
  TableCell,
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
  Commands,
  Audio,
  SearchAndReplace.configure(),
  TextStyle,
  markdownEngine,
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
  Iframe.configure({
    placeholderText: translations.editor.embedPlaceholder,
  }),
];

export { extensions, CollapseHeading, heading, dropFile };

export default function ({ extensions: optsExts, ...opts }) {
  const instance = new Editor({
    ...opts,
    extensions: [...extensions, ...(optsExts || [])],
  });

  return instance;
}
