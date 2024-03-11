import { Editor } from '@tiptap/vue-3';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Code from '@tiptap/extension-code';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import LabelSuggestion from './exts/label-suggestion';
import MathInline from './exts/math-inline';
import MathBlock from './exts/math-block';
import TextDirection from 'tiptap-text-direction';
import CodeBlock from './exts/code-block';
import LinkNote from './exts/link-note';
import FileEmbed from './exts/file-embed';
import Search from './exts/search';
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
import enTranslations from '../../pages/settings/locales/en.json';
import itTranslations from '../../pages/settings/locales/it.json';
import deTranslations from '../../pages/settings/locales/de.json';
import zhTranslations from '../../pages/settings/locales/zh.json';
import nlTranslations from '../../pages/settings/locales/nl.json';

const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';

let translations = enTranslations;

if (selectedLanguage === 'it') {
  translations = itTranslations;
} else if (selectedLanguage === 'de') {
  translations = deTranslations;
} else if (selectedLanguage === 'zh') {
  translations = zhTranslations;
} else if (selectedLanguage === 'nl') {
  translations = nlTranslations;
}

export const extensions = [
  StarterKit,
  BubbleMenu.configure({
    pluginKey: 'bubbleMenuOne',
    element: document.querySelector('.menu-one'),
  }),
  BubbleMenu.configure({
    pluginKey: 'bubbleMenuTwo',
    element: document.querySelector('.menu-two'),
  }),
  Highlight,
  Typography,
  LiteralTab,
  Underline,
  blueCallout,
  yellowCallout,
  redCallout,
  purpleCallout,
  blackCallout,
  greenCallout,
  LinkNote,
  FileEmbed,
  LabelSuggestion,
  TaskList,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  TaskItem.configure({
    nested: true,
  }),
  CodeBlock,
  MathInline,
  MathBlock,
  TextDirection.configure({
    types: ['heading', 'paragraph'],
  }),
  Image,
  Search,
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
];

export default function ({ extensions: optsExts, ...opts }) {
  const instance = new Editor({
    ...opts,
    extensions: [...extensions, ...(optsExts || [])],
  });

  return instance;
}
