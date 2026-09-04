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
      <div class="flex items-center gap-3 px-4 py-4">
        <div
          class="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-white/10 flex items-center justify-center shrink-0"
        >
          <v-remixicon name="riSettings3Line" class="w-5 h-5 text-neutral-600 dark:text-neutral-300" />
        </div>
        <div class="flex-1 min-w-0">
          <h2
            class="text-[13px] font-semibold text-neutral-800 dark:text-white leading-tight"
          >
            {{ translations.toolbarCustomizer?.title || 'Customize toolbar' }}
          </h2>
          <p class="text-xs text-neutral-500 leading-none mt-1">
            <span class="hidden sm:inline">{{
              translations.toolbarCustomizer?.subtitle ||
              'Drag to reorder · toggle visibility'
            }}</span><span class="sm:hidden">Tap to reorder · toggle visibility</span>
          </p>
        </div>
      </div>
    </template>

    <div class="flex flex-col max-h-[72dvh] sm:max-h-[70vh]">
      <div class="overflow-y-auto flex-1 px-3 py-3 overscroll-contain" style="-webkit-overflow-scrolling: touch" @dragover.prevent>
        <template
          v-for="(item, index) in toolbar.allItems.value"
          :key="item.id"
        >
          <p
            v-if="!item.meta?.isDivider && shouldShowGroupLabel(item, index)"
            class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 px-3 pt-4 pb-1.5 select-none"
          >
            {{ item.meta?.group }}
          </p>

          <div
            :data-row-index="index"
            :draggable="true"
            :class="[
              'flex items-center gap-2 px-3 rounded-xl mb-1 cursor-grab active:cursor-grabbing select-none transition-[background-color,box-shadow,opacity,transform] duration-100 min-h-[48px]',
              dragIndex !== null ? 'touch-none' : 'touch-manipulation',
              item.meta?.isDivider ? 'py-1' : 'py-2',
              dragOverIndex === index
                ? 'bg-primary/8 ring-1 ring-inset ring-primary/20'
                : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60 active:bg-neutral-100 dark:active:bg-neutral-800',
              dragIndex === index ? 'opacity-30 scale-[0.98]' : '',
              !item.visible && !item.meta?.isDivider ? 'opacity-60' : '',
            ]"
            @dragstart="onDragStart(index, $event)"
            @dragover.prevent="onDragOver(index)"
            @drop.prevent="onDrop(index)"
            @dragend="onDragEnd"
            @touchstart="onTouchStart(index, $event)"
            @touchmove="onTouchMove($event)"
            @touchend="onTouchEnd"
          >
            <span class="flex w-6 h-6 items-center justify-center shrink-0">
              <v-remixicon
                name="riDraggable"
                class="w-3.5 h-3.5 text-neutral-300"
              />
            </span>

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
                  'h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0',
                  GROUP_STYLES[item.meta?.group]?.bg ??
                    'bg-neutral-100 dark:bg-neutral-900',
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
              class="hoverable w-10 h-10 rounded-xl transition-colors flex items-center justify-center shrink-0 ml-auto touch-manipulation"
              @click.stop="toolbar.toggleItem(item.id)"
              @pointerdown.stop
            >
              <v-remixicon
                :name="item.visible ? 'riEyeLine' : 'riEyeCloseLine'"
                class="w-5 h-5"
              />
            </button>
          </div>
        </template>
      </div>

      <div
        class="px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800"
      >
        <span class="text-xs text-neutral-500">
          <span class="font-semibold text-neutral-700 dark:text-neutral-200">{{
            toolbar.visibleCount.value
          }}</span>
          / {{ toolbar.totalCount.value }}
          {{ translations.toolbarCustomizer?.visible || 'visible' }}
        </span>
        <ui-button variant="primary" size="lg" class="rounded-full px-6" @click="$emit('close')">
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
    function move(idx, dir) {
      const to = idx + dir;
      if (to < 0 || to >= toolbar.allItems.value.length) return;
      toolbar.reorder(idx, to);
    }
    // whole-row touch reorder (press anywhere except eye)
    let touchStartIndex = null;
    let touchStartY = 0;
    function onTouchStart(index, e) {
      const t = e.touches?.[0];
      if (!t) return;
      if (e.target.closest('button')) return;
      touchStartIndex = index;
      touchStartY = t.clientY;
      dragIndex.value = index;
    }
    function onTouchMove(e) {
      if (touchStartIndex === null) return;
      const t = e.touches?.[0];
      if (!t) return;
      const dy = t.clientY - touchStartY;
      if (Math.abs(dy) < 10) return;
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const row = el?.closest('[data-row-index]');
      if (row) {
        const idx = Number(row.dataset.rowIndex);
        if (!Number.isNaN(idx) && idx !== dragOverIndex.value) dragOverIndex.value = idx;
      }
      e.preventDefault();
    }
    function onTouchEnd() {
      if (touchStartIndex !== null && dragOverIndex.value !== null && dragOverIndex.value !== touchStartIndex) {
        toolbar.reorder(touchStartIndex, dragOverIndex.value);
      }
      touchStartIndex = null;
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
      move,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      shouldShowGroupLabel,
      GROUP_STYLES,
      translations,
    };
  },
};
</script>
