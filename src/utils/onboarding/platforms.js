/**
 * Canonical registry for all migration source platforms.
 * Single source of truth for labels, icons, descriptions, and import mappings.
 */

const PLATFORMS = [
  {
    id: 'electron',
    label: 'Beaver Notes (Legacy)',
    shortLabel: 'Beaver Notes',
    badge: 'Legacy',
    description: 'Bring over your data from Beaver Notes (Legacy).',
    importDescription: null,
    whatGetsCopied:
      'Notes, folders, labels, settings, note assets, file assets, passwords, and stored sync keys all move into the new workspace.',
    icon: 'beaver',
    useLogoImg: true,
    iconBg: 'rgba(245, 158, 11, 0.12)',
    sourceMap: null,
    macOnly: false,
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    description: "Import your vault's markdown notes and attachments.",
    importDescription:
      'Choose your Obsidian vault folder when import starts. Notes and folders will come across as-is.',
    whatGetsCopied: null,
    icon: 'obsidian',
    iconColor: 'text-[#7C60D7]',
    iconBg: 'rgba(124, 96, 215, 0.12)',
    sourceMap: 'obsidian',
    macOnly: false,
  },
  {
    id: 'apple-notes',
    label: 'Apple Notes',
    description: 'Import notes from Apple Notes.',
    importDescription:
      'Beaver Notes will request access to Apple Notes and import directly from the app.',
    whatGetsCopied: null,
    icon: 'riAppleFill',
    iconColor: 'text-primary',
    iconBg: 'rgba(255, 204, 0, 0.15)',
    sourceMap: 'appleNotes',
    macOnly: true,
  },
  {
    id: 'bear',
    label: 'Bear',
    description: 'Import Bear notes exported as markdown files.',
    importDescription:
      'Choose the folder Bear exported in Markdown format. Tags and images will be imported when available.',
    whatGetsCopied: null,
    icon: 'bear',
    iconColor: 'text-[#EA581C]',
    iconBg: 'rgba(234, 88, 12, 0.12)',
    sourceMap: 'bear',
    macOnly: false,
  },
  {
    id: 'simplenote',
    label: 'Simplenote',
    description: 'Import notes from a Simplenote JSON export.',
    importDescription: 'Choose the exported notes.json file from Simplenote.',
    whatGetsCopied:
      'Notes, tags, and timestamps will be imported into Beaver Notes.',
    icon: 'simpleNote',
    iconColor: 'text-blue-500',
    iconBg: 'rgba(59, 130, 246, 0.12)',
    sourceMap: 'simplenote',
    macOnly: false,
  },
  {
    id: 'markdown',
    label: 'Markdown files',
    description: 'Import a folder of plain .md files from any source.',
    importDescription:
      'Choose any folder of Markdown files. Subfolders become Beaver Notes folders.',
    whatGetsCopied: null,
    icon: 'riMarkdownLine',
    iconColor: 'text-neutral-600 dark:text-neutral-300',
    iconClass: 'bg-neutral-400/10',
    sourceMap: 'genericMd',
    macOnly: false,
  },
  {
    id: 'evernote',
    label: 'Evernote',
    description: 'Import notes from an Evernote ENEX export file.',
    importDescription:
      'Choose an ENEX export file. You can optionally map the source notebook into a Beaver Notes folder.',
    whatGetsCopied: null,
    icon: 'riEvernoteFill',
    iconColor: 'text-[#00A550]',
    iconBg: 'rgba(0, 165, 80, 0.12)',
    sourceMap: 'evernote',
    macOnly: false,
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Import pages exported from Notion as markdown.',
    importDescription:
      'Choose the unzipped Notion export folder. Markdown pages and exported assets will be imported.',
    whatGetsCopied: null,
    icon: 'riNotionFill',
    iconColor: 'text-neutral-900 dark:text-white',
    iconClass: 'bg-neutral-900/10 dark:bg-white/10',
    sourceMap: 'notion',
    macOnly: false,
  },
];

const PLATFORM_ORDER = [
  'electron',
  'apple-notes',
  'bear',
  'evernote',
  'markdown',
  'notion',
  'obsidian',
  'simplenote',
];

export const MIGRATION_PLATFORMS = PLATFORMS;

export const ALL_PLATFORMS = [...PLATFORMS].sort(
  (a, b) => PLATFORM_ORDER.indexOf(a.id) - PLATFORM_ORDER.indexOf(b.id)
);

export const PLATFORM_LABELS = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p.label])
);

export const PLATFORM_ICONS = Object.fromEntries(
  PLATFORMS.map((p) => [
    p.id,
    {
      icon: p.icon,
      useLogo: p.useLogoImg,
      bg: p.iconBg,
      color: p.iconColor,
      iconClass: p.iconClass,
    },
  ])
);

export const ONBOARDING_IMPORT_SOURCE_MAP = Object.fromEntries(
  PLATFORMS.filter((p) => p.sourceMap).map((p) => [p.id, p.sourceMap])
);

export function getMigrationSourceCopy(platformId) {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!platform) return 'Choose a source before starting the import.';
  if (platform.importDescription === null) return null;
  return platform.importDescription;
}

export function getMigrationWhatGetsCopied(platformId) {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!platform || !platform.whatGetsCopied) {
    return 'Notes, folders, labels, timestamps, and exported attachments will be imported when the source provides them.';
  }
  return platform.whatGetsCopied;
}
