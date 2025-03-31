import { Editor } from '@tiptap/vue-3';
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
import CodeBlock from './exts/code-block';
import LinkNote from './exts/link-note';
import FileEmbed from './exts/file-block';
import Audio from './exts/audio-block';
import Text from '@tiptap/extension-text';
import drawingCanvas from './exts/drawing-block';
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
import enTranslations from '../../pages/settings/locales/en.json';
import itTranslations from '../../pages/settings/locales/it.json';
import deTranslations from '../../pages/settings/locales/de.json';
import esTranslations from '../../pages/settings/locales/es.json';
import zhTranslations from '../../pages/settings/locales/zh.json';
import nlTranslations from '../../pages/settings/locales/nl.json';
import ukTranslations from '../../pages/settings/locales/uk.json';
import ruTranslations from '../../pages/settings/locales/ru.json';
import frTranslations from '../../pages/settings/locales/fr.json';

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
}

const extensions = [
  StarterKit,
  Highlight.extend({ priority: 1000 }).configure({
    multicolor: true,
  }),
  Typography,
  Document.extend({
    content: 'block+ (footnotes)?',
    allowGapCursor: true,
  }),
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
  LabelSuggestion,
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
  Paste,
  SearchAndReplace.configure(),
  drawingCanvas,
  TextStyle,
  markdownEngine,
  Placeholder.configure({
    placeholder: translations.tiptap.placeholder,
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
    HTMLAttributes: {
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
      'tiptap-url': 'true',
      title: 'Ctrl+Click to open URL',
    },
  }),
  Iframe,
];

export { extensions, CollapseHeading };

export default function ({ extensions: optsExts, ...opts }) {
  const instance = new Editor({
    ...opts,
    extensions: [...extensions, ...(optsExts || [])],
  });

  return instance;
}
