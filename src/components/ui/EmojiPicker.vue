<template>
  <div class="beaver-emoji-picker" style="container-type: inline-size">
    <div class="mb-2">
      <ui-input
        v-model.lowercase="searchQuery"
        class="w-full note-search-input"
        prepend-icon="riSearch2Line"
        :clearable="true"
        :placeholder="translations.card?.searchEmojis || translations.index.search"
        @keydown.esc="searchQuery = ''"
      />
    </div>

    <div
      v-if="!searchQuery"
      class="flex gap-1 mb-3 justify-center"
    >
        <button
          v-for="category in emojiCategories"
          :key="category.name"
          type="button"
          :class="{
            'bg-primary text-white': selectedCategory === category.name,
            'bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700':
              selectedCategory !== category.name,
          }"
          class="flex items-center gap-2 p-2 rounded-full text-xs font-medium transition-[background-color,color] duration-200"
          :aria-label="category.name"
          :aria-pressed="selectedCategory === category.name"
          @click="
            selectedCategory =
              selectedCategory === category.name ? null : category.name
          "
        >
          <v-remixicon :name="category.icon" />
        </button>
      </div>

      <!-- Recents: last picks, no search needed. -->
      <div v-if="showRecents" class="mb-3">
        <div class="flex items-center justify-between mb-1.5 px-0.5">
          <p class="text-xs font-semibold text-neutral-500">{{ recentLabel }}</p>
          <button
            type="button"
            class="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
            @click="clearRecents"
          >
            {{ clearLabel }}
          </button>
        </div>
        <div class="grid gap-1" :style="gridStyle">
          <button
            v-for="char in recents"
            :key="`recent-${char}`"
            type="button"
            class="emoji-glyph motion-press text-lg p-1 min-w-0 w-full aspect-square flex items-center justify-center rounded-lg transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            :class="{ 'bg-primary/15 ring-1 ring-primary': char === current }"
            :aria-label="char"
            :aria-pressed="char === current"
            @click="pickChar(char)"
          >
            {{ char }}
          </button>
        </div>
      </div>

      <div
        v-if="loading"
        class="flex items-center justify-center py-8"
        role="status"
        aria-label="Loading emojis"
      >
        <ui-spinner size="24" />
      </div>

      <template v-else>
        <div
          class="grid gap-1 max-h-52 overflow-y-auto relative"
          :style="[gridStyle, fullGridHeight]"
          :class="{
            'pb-12': activeSkinToneBase && skinToneMap[activeSkinToneBase],
          }"
        >
          <button
            v-for="emoji in filteredEmojis"
            :key="emoji.char"
            type="button"
            class="emoji-glyph motion-press text-lg p-1 min-w-0 w-full aspect-square flex items-center justify-center rounded-lg transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            :class="{
              'bg-primary/15 ring-1 ring-primary': emoji.char === current,
            }"
            :title="emoji.name"
            :aria-label="emoji.name"
            :aria-pressed="emoji.char === current"
            @click="selectEmoji(emoji)"
          >
            {{ emoji.char }}
          </button>

          <!-- Skin tone selector (bottom overlay, never shifts the grid) -->
          <div
            v-if="activeSkinToneBase && skinToneMap[activeSkinToneBase]"
            class="absolute left-0 right-0 bottom-0 z-10 flex justify-center gap-1 py-1.5 border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-[0_-4px_8px_-2px_rgba(0,0,0,0.08)]"
          >
            <button
              v-for="variant in skinToneMap[activeSkinToneBase]"
              :key="variant.char"
              type="button"
              class="emoji-glyph text-lg p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              :class="{
                'bg-primary/15 ring-1 ring-primary':
                  variant.char === current,
              }"
              :title="variant.name"
              :aria-label="variant.name"
              @click="selectSkinToneVariant(variant.char)"
            >
              {{ variant.char }}
            </button>
          </div>
        </div>
    </template>

    <div
      v-if="filteredEmojis.length === 0"
      class="text-center py-8 text-neutral-500 dark:text-neutral-400"
    >
      <v-remixicon
        name="riEmotionUnhappyLine"
        class="w-8 h-8 mx-auto mb-2 opacity-50"
      />
      <p class="text-sm">{{ translations.card.noEmojis }}</p>
      <p class="text-xs mt-1">
        {{ translations.card.noEmojisMessage }}
      </p>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import {
  loadEmojiDataset,
  normalizeEmojiText,
  filterEmojisByQuery,
} from '@/lib/emojis';

// Dataset loading and the name search live in @/lib/emojis so the customize
// dialog's suggestions use the exact same data and matching rules.
function readRecents(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(parsed)) {
      return parsed.filter((c) => typeof c === 'string').slice(0, 64);
    }
  } catch {
    // Private mode or corrupt value: just start empty.
  }
  return [];
}

const emojiCategories = [
  {
    name: 'Smileys & Emotion',
    icon: 'riEmotionLine',
    groups: ['Smileys & Emotion', 'People & Body'],
  },
  {
    name: 'Animals & Nature',
    icon: 'riLeafLine',
    groups: ['Animals & Nature'],
  },
  {
    name: 'Food & Drink',
    icon: 'riCake3Line',
    groups: ['Food & Drink'],
  },
  {
    name: 'Activities',
    icon: 'riFootballLine',
    groups: ['Activities'],
  },
  {
    name: 'Travel & Places',
    icon: 'riPlaneLine',
    groups: ['Travel & Places'],
  },
  {
    name: 'Objects',
    icon: 'riLightbulbLine',
    groups: ['Objects'],
  },
  {
    name: 'Hearts',
    icon: 'riHeartLine',
    groups: ['Smileys & Emotion'],
    subgroups: ['heart'],
  },
  {
    name: 'Flags',
    icon: 'riFlagLine',
    groups: ['Flags'],
  },
  {
    name: 'Symbols',
    icon: 'riShapesLine',
    groups: ['Symbols'],
  },
];

export default {
  name: 'EmojiPicker',
  props: {
    current: { type: String, default: '' },
    columns: { type: Number, default: 8 },
    maxRecents: { type: Number, default: 8 },
    recentKey: { type: String, default: 'beaver-recent-emojis' },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const { translations } = useTranslations();
    const searchQuery = ref('');
    const selectedCategory = ref(null);
    const activeSkinToneBase = ref(null);
    const allEmojis = ref([]);
    const skinToneMap = ref({});
    const loading = ref(true);
    const recents = ref([]);

    const gridStyle = computed(() => ({
      gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`,
    }));

    const fullGridHeight = computed(() => ({
      maxHeight: `calc((100cqw - 1.75rem) / ${props.columns} * 5 + 1rem)`,
    }));

    const recentLabel = computed(
      () => translations.value.card?.recentEmojis || 'Recent',
    );
    const clearLabel = computed(
      () => translations.value.card?.clear || translations.value.dialog?.clear || 'Clear',
    );

    const showRecents = computed(
      () =>
        !searchQuery.value && !selectedCategory.value && recents.value.length > 0,
    );

    const filteredEmojis = computed(() => {
      const query = normalizeEmojiText(searchQuery.value).trim();
      if (query) return filterEmojisByQuery(allEmojis.value, query);
      if (selectedCategory.value) {
        const category = emojiCategories.find(
          (cat) => cat.name === selectedCategory.value,
        );
        if (!category) return allEmojis.value;
        return allEmojis.value.filter((emoji) => {
          const mainGroup = (emoji.group || '').split(' (')[0];
          const inGroup = category.groups.includes(mainGroup);
          const inSubgroup = category.subgroups
            ? category.subgroups.includes(emoji.subgroup || '')
            : true;
          return inGroup && inSubgroup;
        });
      }
      return allEmojis.value;
    });

    function pushRecent(char) {
      if (!char) return;
      const next = [char, ...recents.value.filter((c) => c !== char)].slice(
        0,
        props.maxRecents,
      );
      recents.value = next;
      try {
        localStorage.setItem(props.recentKey, JSON.stringify(next));
      } catch {
        // Recents just don't persist.
      }
    }

    function clearRecents() {
      recents.value = [];
      try {
        localStorage.removeItem(props.recentKey);
      } catch {
        // Nothing persisted.
      }
    }

    function pickChar(char) {
      pushRecent(char);
      emit('select', char);
    }

    function selectEmoji(emoji) {
      if (!searchQuery.value && skinToneMap.value[emoji.name]) {
        activeSkinToneBase.value =
          activeSkinToneBase.value === emoji.name ? null : emoji.name;
        return;
      }
      activeSkinToneBase.value = null;
      pickChar(emoji.char);
    }

    function selectSkinToneVariant(char) {
      activeSkinToneBase.value = null;
      pickChar(char);
    }

    onMounted(() => {
      recents.value = readRecents(props.recentKey);
      loadEmojiDataset()
        .then(({ base, skinToneMap: map }) => {
          allEmojis.value = base;
          skinToneMap.value = map;
        })
        .catch(() => {
          // Offline/broken dataset: show the empty state, never spin forever.
        })
        .finally(() => {
          loading.value = false;
        });
    });

    return {
      translations,
      emojiCategories,
      searchQuery,
      selectedCategory,
      activeSkinToneBase,
      skinToneMap,
      loading,
      recents,
      gridStyle,
      fullGridHeight,
      recentLabel,
      clearLabel,
      showRecents,
      filteredEmojis,
      pickChar,
      clearRecents,
      selectEmoji,
      selectSkinToneVariant,
    };
  },
};
</script>

<style scoped>
.emoji-glyph {
  font-family:
    'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji',
    'Twemoji', sans-serif;
}
</style>
