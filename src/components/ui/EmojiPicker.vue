<template>
  <div class="beaver-emoji-picker">
    <div class="mb-2">
      <ui-input
        :model-value="searchQuery"
        class="w-full note-search-input"
        prepend-icon="riSearch2Line"
        :clearable="true"
        :placeholder="translations.index.search"
        @keydown.esc="$event.target.blur()"
        @change="searchQuery = $event.toLowerCase()"
      />
    </div>

    <div
      v-if="!searchQuery"
      class="flex flex-wrap gap-1 mb-3 justify-center"
    >
      <button
        v-for="category in emojiCategories"
        :key="category.name"
        :class="{
          'bg-primary text-white': selectedCategory === category.name,
          'bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700':
            selectedCategory !== category.name,
        }"
        class="flex items-center gap-2 p-2 rounded-full text-xs font-medium transition-[background-color,color] duration-200"
        @click="
          selectedCategory =
            selectedCategory === category.name ? null : category.name
        "
      >
        <v-remixicon :name="category.icon" />
      </button>
    </div>

    <div
      class="grid grid-cols-8 gap-1 max-h-52 overflow-y-auto relative"
      :class="{
        'pb-12': activeSkinToneBase && skinToneMap[activeSkinToneBase],
      }"
    >
      <button
        v-for="emoji in filteredEmojis"
        :key="emoji.char"
        class="text-xl p-1.5 rounded-lg transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        :class="{
          'bg-primary/15 ring-1 ring-primary': emoji.char === current,
        }"
        style="
          font-family:
            'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji',
            'Twemoji', sans-serif;
        "
        :title="emoji.name"
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
          class="text-lg p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          :class="{
            'bg-primary/15 ring-1 ring-primary':
              variant.char === current,
          }"
          style="
            font-family:
              'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji',
              'Twemoji', sans-serif;
          "
          :title="variant.name"
          @click="selectSkinToneVariant(variant.char)"
        >
          {{ variant.char }}
        </button>
      </div>
    </div>

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
  buildSkinToneMap,
  isSkinToneVariant,
} from '@/utils/helpers/skin-tones.js';

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
    name: 'Travel & Places',
    icon: 'riPlaneLine',
    groups: ['Travel & Places'],
  },
  {
    name: 'Activities',
    icon: 'riFootballLine',
    groups: ['Activities'],
  },
  {
    name: 'Objects',
    icon: 'riLightbulbLine',
    groups: ['Objects'],
  },
  {
    name: 'Symbols & Flags',
    icon: 'riFlagLine',
    groups: ['Symbols', 'Flags'],
  },
];

export default {
  name: 'EmojiPicker',
  props: {
    /** Currently selected emoji character (highlighted in the grid). */
    current: { type: String, default: '' },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const { translations } = useTranslations();
    const searchQuery = ref('');
    const selectedCategory = ref(null);
    const activeSkinToneBase = ref(null);
    const emojis = ref([]);
    const skinToneMap = ref({});

    const filteredEmojis = computed(() => {
      let filtered = emojis.value;

      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        filtered = filtered.filter((emoji) =>
          emoji.name.toLowerCase().includes(query),
        );
      } else if (selectedCategory.value) {
        const category = emojiCategories.find(
          (cat) => cat.name === selectedCategory.value,
        );
        if (category) {
          filtered = filtered.filter((emoji) => {
            const mainGroup = (emoji.group || '').split(' (')[0];
            const inGroup = category.groups.includes(mainGroup);
            const inSubgroup = category.subgroups
              ? category.subgroups.includes(emoji.subgroup || '')
              : true;
            return inGroup && inSubgroup;
          });
        }
      }

      const seen = new Set();
      filtered = filtered.filter((emoji) => {
        if (isSkinToneVariant(emoji.name)) return false;
        const normalized = emoji.char.normalize('NFC').replace(/\uFE0F/g, '');
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });

      return filtered;
    });

    function selectEmoji(emoji) {
      if (!searchQuery.value && skinToneMap.value[emoji.name]) {
        activeSkinToneBase.value =
          activeSkinToneBase.value === emoji.name ? null : emoji.name;
        return;
      }
      activeSkinToneBase.value = null;
      emit('select', emoji.char);
    }

    function selectSkinToneVariant(char) {
      activeSkinToneBase.value = null;
      emit('select', char);
    }

    onMounted(() => {
      // The ~900 KB dataset is parsed only once the picker is opened
      // (parents mount this conditionally); rendered by the OS font.
      import('emoji.json').then((mod) => {
        const data = mod.default || mod;
        emojis.value = data;
        skinToneMap.value = buildSkinToneMap(data);
      });
    });

    return {
      translations,
      emojiCategories,
      searchQuery,
      selectedCategory,
      activeSkinToneBase,
      skinToneMap,
      filteredEmojis,
      selectEmoji,
      selectSkinToneVariant,
    };
  },
};
</script>
