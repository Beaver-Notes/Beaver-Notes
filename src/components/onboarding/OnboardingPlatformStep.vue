<template>
  <ui-card class="w-full max-w-lg">
    <div class="flex flex-col items-center gap-2 my-8 text-center">
      <h2 class="text-3xl font-semibold tracking-tight ob-heading-text">
        Import from apps
      </h2>
      <p class="ob-body-text">
        Choose which app to migrate from before reviewing the import details.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <platform-card
        v-for="p in visiblePlatforms"
        :key="p.id"
        :platform="p"
        :selected="modelValue === p.id"
        :logo-url="logoUrl"
        @select="$emit('update:modelValue', p.id)"
      />
    </div>

    <div class="mt-5 flex justify-between gap-4">
      <slot name="back" />
      <slot name="next" />
    </div>
  </ui-card>
</template>

<script>
import { computed, defineComponent } from 'vue';

/** Renders a single platform choice card. */
const PlatformCard = defineComponent({
  name: 'PlatformCard',
  props: {
    platform: { type: Object, required: true },
    selected: { type: Boolean, default: false },
    logoUrl: { type: String, default: '' },
  },
  emits: ['select'],
  template: `
    <ui-card
      tag="button"
      padding="p-0"
      class="w-full text-left"
      :class="selected ? 'ring-2 ring-primary' : ''"
      @click="$emit('select')"
    >
      <div class="flex items-center gap-4 p-4">
        <div
          class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          :style="platform.iconBg ? { background: platform.iconBg } : {}"
          :class="platform.iconClass || ''"
        >
          <img
            v-if="platform.useLogoImg"
            :src="logoUrl"
            alt="Beaver Notes"
            class="w-6 h-6 object-contain"
          />
          <v-remixicon
            v-else
            :name="platform.icon"
            :class="platform.iconColor || ''"
          />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <h3 class="font-semibold text-sm ob-heading-text">{{ platform.label }}</h3>
            <span
              v-if="platform.badge"
              class="inline-flex items-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5"
            >{{ platform.badge }}</span>
          </div>
          <p class="text-sm ob-body-text">{{ platform.description }}</p>
        </div>
        <v-remixicon
          v-if="selected"
          name="riCheckLine"
          class="shrink-0 text-primary"
        />
        <v-remixicon
          v-else
          name="riArrowRightLine"
          class="shrink-0 opacity-30"
        />
      </div>
    </ui-card>
  `,
});

const ALL_PLATFORMS = [
  {
    id: 'electron',
    label: 'Beaver Notes',
    badge: 'Legacy',
    description: 'Bring over your original Beaver Notes workspace.',
    useLogoImg: true,
    iconBg: 'rgba(245, 158, 11, 0.12)',
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    description: 'Import your vault\'s markdown notes and attachments.',
    icon: 'obsidian',
    iconColor: 'text-[#7C60D7]',
    iconBg: 'rgba(124, 96, 215, 0.12)',
  },
  {
    id: 'apple-notes',
    label: 'Apple Notes',
    description: 'Import notes exported from Apple Notes.',
    icon: 'riAppleFill',
    iconColor: 'text-primary',
    iconBg: 'rgba(255, 204, 0, 0.15)',
    macOnly: true,
  },
  {
    id: 'bear',
    label: 'Bear',
    description: 'Import Bear notes exported as markdown files.',
    icon: 'bear',
    iconColor: 'text-[#EA581C]',
    iconBg: 'rgba(234, 88, 12, 0.12)',
  },
  {
    id: 'simplenote',
    label: 'Simplenote',
    description: 'Import notes from a Simplenote JSON export.',
    icon: 'simpleNote',
    iconBg: 'rgba(59, 130, 246, 0.12)',
  },
  {
    id: 'markdown',
    label: 'Markdown files',
    description: 'Import a folder of plain .md files from any source.',
    icon: 'riMarkdownLine',
    iconColor: 'text-neutral-600 dark:text-neutral-300',
    iconClass: 'bg-neutral-400/10',
  },
  {
    id: 'evernote',
    label: 'Evernote',
    description: 'Import notes from an Evernote ENEX export file.',
    icon: 'riEvernoteFill',
    iconColor: 'text-[#00A550]',
    iconBg: 'rgba(0, 165, 80, 0.12)',
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Import pages exported from Notion as markdown.',
    icon: 'riNotionFill',
    iconColor: 'text-neutral-900 dark:text-white',
    iconClass: 'bg-neutral-900/10 dark:bg-white/10',
  },
];

export default {
  name: 'OnboardingPlatformStep',
  components: { PlatformCard },

  props: {
    modelValue: { type: String, default: null },
    isMacOS: { type: Boolean, default: false },
    logoUrl: { type: String, required: true },
  },

  emits: ['update:modelValue'],

  setup(props) {
    const visiblePlatforms = computed(() =>
      ALL_PLATFORMS.filter((p) => !p.macOnly || props.isMacOS)
    );
    return { visiblePlatforms };
  },
};
</script>
