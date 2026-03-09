<template>
  <ui-modal
    :model-value="modelValue"
    blur
    :persist="true"
    content-class="sm:max-w-[440px] !p-0 overflow-hidden"
    @close="$emit('close')"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-lg bg-black/5 dark:bg-white/5 flex items-center justify-center flex-shrink-0"
        >
          <v-remixicon name="riSettings3Line" class="w-8 text-neutral-500" />
        </div>
        <div class="flex-1 min-w-0">
          <h2
            class="text-sm font-semibold text-neutral-800 dark:text-white leading-tight"
          >
            {{ translations.toolbarCustomizer?.title || 'Customize Toolbar' }}
          </h2>
          <p class="text-xs text-neutral-400 leading-none mt-0.5">
            {{
              translations.toolbarCustomizer?.subtitle ||
              'Drag to reorder · toggle visibility'
            }}
          </p>
        </div>
        <ui-button variant="danger" @click="toolbar.reset()">
          {{ translations.toolbarCustomizer?.reset || 'Reset' }}
        </ui-button>
      </div>
    </template>

    <div class="flex flex-col max-h-[70vh]">
      <div class="overflow-y-auto flex-1 px-2 py-2" @dragover.prevent>
        <template
          v-for="(item, index) in toolbar.allItems.value"
          :key="item.id"
        >
          <p
            v-if="!item.meta?.isDivider && shouldShowGroupLabel(item, index)"
            class="text-sm font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-600 px-3 pt-3 pb-1 select-none"
          >
            {{ item.meta?.group }}
          </p>

          <div
            :draggable="true"
            :class="[
              'flex items-center gap-2.5 px-3 rounded-xl mb-0.5 cursor-grab active:cursor-grabbing select-none transition-[background-color,box-shadow,opacity,transform] duration-100',
              item.meta?.isDivider ? 'py-1.5' : 'py-2',
              dragOverIndex === index
                ? 'bg-primary/8 ring-1 ring-inset ring-primary/20'
                : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60',
              dragIndex === index ? 'opacity-30 scale-[0.98]' : '',
              !item.visible && !item.meta?.isDivider ? 'opacity-50' : '',
            ]"
            @dragstart="onDragStart(index, $event)"
            @dragover.prevent="onDragOver(index)"
            @drop.prevent="onDrop(index)"
            @dragend="onDragEnd"
          >
            <v-remixicon
              name="riDraggable"
              class="w-3.5 h-3.5 text-neutral-300 flex-shrink-0"
            />

            <template v-if="item.meta?.isDivider">
              <div class="flex-1 flex items-center gap-1.5">
                <div class="flex-1 border-t border-dashed" />
                <span
                  class="text-[10px] text-neutral-300 dark:text-neutral-700"
                  >{{
                    translations.toolbarCustomizer?.divider || 'divider'
                  }}</span
                >
                <div class="flex-1 border-t border-dashed" />
              </div>
            </template>

            <template v-else>
              <div
                :class="[
                  'h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0',
                  GROUP_STYLES[item.meta?.group]?.bg ??
                    'bg-neutral-100 dark:bg-neutral-800',
                ]"
              >
                <v-remixicon
                  v-if="item.meta?.icon"
                  :name="item.meta.icon"
                  :class="[
                    'h-5',
                    GROUP_STYLES[item.meta?.group]?.icon ?? 'text-neutral-500',
                  ]"
                />
              </div>
              <span
                :class="[
                  'flex-1 text-xs font-medium truncate',
                  item.visible
                    ? 'text-neutral-700 dark:text-neutral-200'
                    : 'text-neutral-400 dark:text-neutral-600',
                ]"
              >
                {{ item.meta?.label }}
              </span>
            </template>

            <button
              :model-value="item.visible"
              class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
              @click.stop="toolbar.toggleItem(item.id)"
            >
              <v-remixicon
                :name="item.visible ? 'riEyeLine' : 'riEyeCloseLine'"
              />
            </button>
          </div>
        </template>
      </div>

      <div
        class="px-4 py-3 border-t flex items-center justify-between bg-white dark:bg-neutral-900"
      >
        <span class="text-xs text-neutral-400">
          <span class="font-semibold text-neutral-600 dark:text-neutral-300">{{
            toolbar.visibleCount.value
          }}</span>
          / {{ toolbar.totalCount.value }}
          {{ translations.toolbarCustomizer?.visible || 'visible' }}
        </span>
        <ui-button variant="primary" @click="$emit('close')">
          {{ translations.toolbarCustomizer?.done || 'Done' }}
        </ui-button>
      </div>
    </div>
  </ui-modal>
</template>

<script>
import { ref } from 'vue';
import { useToolbarConfig } from '@/composable/useToolbarConfig';
import { useTranslations } from '@/composable/useTranslations';

export const GROUP_STYLES = {
  text: { bg: 'bg-blue-50 dark:bg-blue-950/40', icon: 'text-blue-500' },
  formatting: {
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    icon: 'text-violet-500',
  },
  blocks: { bg: 'bg-amber-50 dark:bg-amber-950/40', icon: 'text-amber-500' },
  media: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    icon: 'text-emerald-500',
  },
  actions: { bg: 'bg-rose-50 dark:bg-rose-950/40', icon: 'text-rose-500' },
  plugins: {
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    icon: 'text-violet-400',
  },
};

export default {
  name: 'ToolbarCustomizer',
  props: {
    modelValue: Boolean,
  },
  emits: ['close', 'update:modelValue'],
  setup() {
    const { translations } = useTranslations();
    const toolbar = useToolbarConfig();
    const dragIndex = ref(null);
    const dragOverIndex = ref(null);

    function onDragStart(index, event) {
      dragIndex.value = index;
      event.dataTransfer.effectAllowed = 'move';
    }
    function onDragOver(index) {
      if (dragIndex.value !== null && dragIndex.value !== index)
        dragOverIndex.value = index;
    }
    function onDrop(toIndex) {
      if (dragIndex.value === null) return;
      toolbar.reorder(dragIndex.value, toIndex);
      dragIndex.value = null;
      dragOverIndex.value = null;
    }
    function onDragEnd() {
      dragIndex.value = null;
      dragOverIndex.value = null;
    }

    function shouldShowGroupLabel(item, index) {
      if (item.meta?.isDivider) return false;
      const prev = toolbar.allItems.value
        .slice(0, index)
        .reverse()
        .find((i) => !i.meta?.isDivider);
      return !prev || prev.meta?.group !== item.meta?.group;
    }

    return {
      toolbar,
      dragIndex,
      dragOverIndex,
      onDragStart,
      onDragOver,
      onDrop,
      onDragEnd,
      shouldShowGroupLabel,
      GROUP_STYLES,
      translations,
    };
  },
};
</script>
