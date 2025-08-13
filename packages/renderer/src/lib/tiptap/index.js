import { Editor } from '@tiptap/vue-3';
import heading from './exts/headings';
import Video from './exts/video-block';
import Document from '@tiptap/extension-document';
import StarterKit from '@tiptap/starter-kit';
import Highlight from './exts/highlight';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
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
} from './exts/Callouts';
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
import { TrailingNode } from '@tiptap/extensions';
import { dropFile } from './exts/drop-file';
import enTranslations from '@/assets/locales/en.json';
import itTranslations from '@/assets/locales/it.json';
import esTranslations from '@/assets/locales/es.json';
import deTranslations from '@/assets/locales/de.json';
import zhTranslations from '@/assets/locales/zh.json';
import nlTranslations from '@/assets/locales/nl.json';
import ukTranslations from '@/assets/locales/uk.json';
import frTranslations from '@/assets/locales/fr.json';
import ruTranslations from '@/assets/locales/ru.json';
import arTranslations from '@/assets/locales/ar.json';

const directionPreference = localStorage.getItem('directionPreference');

const defaultDirection = directionPreference === 'rtl' ? 'rtl' : 'ltr';

const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';

let translations = enTranslations;

if (selectedLanguage === 'de') {
  translations = deTranslations;
} else if (selectedLanguage === 'en') {
  translations = enTranslations;
} else if (selectedLanguage === 'es') {
  translations = esTranslations;
} else if (selectedLanguage === 'fr') {
  translations = frTranslations;
} else if (selectedLanguage === 'it') {
  translations = itTranslations;
} else if (selectedLanguage === 'nl') {
  translations = nlTranslations;
} else if (selectedLanguage === 'ru') {
  translations = ruTranslations;
} else if (selectedLanguage === 'uk') {
  translations = ukTranslations;
} else if (selectedLanguage === 'zh') {
  translations = zhTranslations;
} else if (selectedLanguage === 'ar') {
  translations = arTranslations;
}

const extensions = [
  LabelSuggestion,
  StarterKit.configure({
    heading: false,
    text: false,
    codeBlock: false,
    code: false,
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
  Underline,
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
  TrailingNode,
  Placeholder.configure({
    placeholder: translations.editor.tiptapPlaceholder,
  }),
  Code.configure({ HTMLAttributes: { class: 'inline-code' } }),
  Link.extend({
    addKeyboardShortcuts() {
      return {
        'Mod-k': () => this.editor.chain().focus().toggleLink().run(),
      };
    },
  }).configure({
    openOnClick: false,
    protocols: ['http', 'https', 'mailto', 'note'],
    HTMLAttributes: {
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
      'tiptap-url': 'true',
      title: 'Ctrl+Click to open URL',
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
