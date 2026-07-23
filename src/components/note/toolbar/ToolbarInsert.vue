<template>
  <!-- ── Link popover ── -->
  <ui-popover
    v-if="isItemVisible('link')"
    :model-value="linkPopoverOpen"
    @update:model-value="$emit('update:linkPopoverOpen', $event)"
    @show="onLinkPopoverShow"
  >
    <template #trigger>
      <button
        v-tooltip.group="translations.menu.link"
        :aria-label="translations.menu.link"
        :class="tbBtn(editor.isActive('link') || linkPopoverOpen)"
      >
        <v-remixicon name="riLink" />
      </button>
    </template>

    <div class="min-w-[260px]">
      <div class="flex items-center gap-2">
        <input
          ref="linkInputRef"
          :value="linkInputValue"
          type="text"
          @input="$emit('update:linkInputValue', $event.target.value)"
          :placeholder="
            translations.editor?.linkPlaceholder ||
            'Enter URL or @note'
          "
          class="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 text-sm outline-none border border-transparent focus:border-primary transition-colors"
          @keydown="onLinkInputKeydown"
          @keydown.esc="closeLinkInput"
          @keyup.enter="saveLinkInput"
        />
        <button
          class="h-7 w-7 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center justify-center text-neutral-500"
          :title="translations.common?.cancel || 'Cancel'"
          :aria-label="translations.common?.cancel || 'Cancel'"
          @click="closeLinkInput"
        >
          <v-remixicon name="riCloseLine" class="size-4" />
        </button>
        <button
          class="h-7 w-7 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center justify-center text-primary"
          :title="translations.common?.save || 'Save'"
          :aria-label="translations.common?.save || 'Save'"
          :disabled="!linkInputValue.trim()"
          @click="saveLinkInput"
        >
          <v-remixicon name="riCheckLine" class="size-4" />
        </button>
      </div>

      <div
        v-if="
          linkInputValue.startsWith('@') && linkSuggestions.length > 0
        "
        class="mt-1 max-h-40 overflow-y-auto"
      >
        <button
          v-for="(suggestion, index) in linkSuggestions"
          :key="suggestion.id"
          :class="
            index === selectedLinkIndex
              ? 'bg-neutral-100 dark:bg-neutral-700'
              : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
          "
          class="w-full text-left px-2 py-1.5 rounded-lg text-sm text-neutral-700 dark:text-neutral-300 transition-colors"
          @click="selectLinkNote(suggestion.id)"
        >
          {{
            suggestion.title ||
            translations.editor?.untitledNote ||
            'Untitled Note'
          }}
        </button>
      </div>
      <div
        v-else-if="
          linkInputValue.startsWith('@') &&
          linkSuggestions.length === 0
        "
        class="mt-1 p-1.5 text-sm text-neutral-500 dark:text-neutral-400 italic"
      >
        {{
          translations.editor?.noMatchingNotes ||
          'No matching notes found'
        }}
      </div>
    </div>
  </ui-popover>
  <button
    v-if="isItemVisible('image')"
    v-tooltip.group="translations.menu.image"
    :aria-label="translations.menu.image"
    :class="tbBtn()"
    @click="isMobile ? triggerImageInput() : openSub('image')"
  >
    <v-remixicon name="riImageLine" />
  </button>
  <button
    v-if="isItemVisible('file')"
    v-tooltip.group="translations.menu.file"
    :aria-label="translations.menu.file"
    :class="tbBtn()"
    @click="isMobile ? triggerFileInput() : openSub('file')"
  >
    <v-remixicon name="riFile2Line" />
  </button>
  <button
    v-if="isItemVisible('video')"
    v-tooltip.group="translations.menu.video"
    :aria-label="translations.menu.video"
    :class="tbBtn()"
    @click="isMobile ? triggerVideoInput() : openSub('video')"
  >
    <v-remixicon name="riMovieLine" />
  </button>
  <button
    v-if="isItemVisible('table')"
    v-tooltip.group="translations.menu.table"
    :aria-label="translations.menu.table"
    :class="tbBtn()"
    @click="
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run()
    "
  >
    <v-remixicon name="riTableLine" />
  </button>
  <button
    v-if="isItemVisible('draw')"
    v-tooltip.group="translations.menu.draw"
    :aria-label="translations.menu.draw"
    :class="tbBtn(drawActions.some((action) => action.isActive))"
    @click="editor.chain().focus().insertPaper().run()"
  >
    <v-remixicon name="riBrushLine" />
  </button>

  <!-- Audio -->
  <div class="flex items-center gap-0.5">
    <template v-if="isRecording">
      <button
        :class="tbBtn()"
        class="!text-red-500"
        aria-label="Stop recording"
        @click="toggleRecording"
      >
        <v-remixicon name="riStopCircleLine" />
      </button>
      <span
        class="min-w-10 px-1 text-xs font-semibold tabular-nums text-red-500"
        >{{ formattedTime }}</span
      >
      <button :class="tbBtn()" :aria-label="isPaused ? 'Play recording' : 'Pause recording'" @click="pauseResume">
        <v-remixicon
          :name="isPaused ? 'riPlayFill' : 'riPauseFill'"
        />
      </button>
    </template>
    <template v-else>
      <button
        v-if="isItemVisible('audio')"
        v-tooltip.group="translations.menu.record"
        :aria-label="translations.menu.record"
        :class="tbBtn()"
        @click="openSub('audio')"
      >
        <v-remixicon name="riMicLine" />
      </button>
    </template>
  </div>
</template>

<script>
import { ref } from 'vue';

export default {
  expose: ['linkInputRef'],
  emits: ['update:linkInputValue', 'update:linkPopoverOpen'],
  props: {
    editor: { type: Object, default: () => ({}) },
    translations: { type: Object, required: true },
    isItemVisible: { type: Function, required: true },
    isTableActive: { type: Boolean, default: false },
    tableActions: { type: Array, default: () => [] },
    drawActions: { type: Array, default: () => [] },
    isRecording: { type: Boolean, default: false },
    formattedTime: { type: String, default: '' },
    isPaused: { type: Boolean, default: false },
    toggleRecording: { type: Function, required: true },
    pauseResume: { type: Function, required: true },
    isMobile: { type: Boolean, default: false },
    tbBtn: { type: Function, required: true },
    openSub: { type: Function, required: true },
    // Link input
    linkInputValue: { type: String, default: '' },
    selectedLinkIndex: { type: Number, default: 0 },
    linkSuggestions: { type: Array, default: () => [] },
    linkPopoverOpen: { type: Boolean, default: false },
    onLinkPopoverShow: { type: Function, required: true },
    onLinkInputKeydown: { type: Function, required: true },
    closeLinkInput: { type: Function, required: true },
    saveLinkInput: { type: Function, required: true },
    selectLinkNote: { type: Function, required: true },
    triggerImageInput: { type: Function, required: true },
    triggerFileInput: { type: Function, required: true },
    triggerVideoInput: { type: Function, required: true },
  },
  setup() {
    const linkInputRef = ref(null);
    return { linkInputRef };
  },
};
</script>
