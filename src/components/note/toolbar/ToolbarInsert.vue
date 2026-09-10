<template>
  <button
    v-if="isItemVisible('link')"
    v-keep-focus
    v-tooltip.group="translations.menu.link"
    :aria-label="translations.menu.link"
    :class="tbBtn(editor.isActive('link'))"
    @click="openLinkPanel"
  >
    <v-remixicon name="riLink" />
  </button>

  <button
    v-if="isItemVisible('image')"
    v-keep-focus
    v-tooltip.group="translations.menu.image"
    :aria-label="translations.menu.image"
    :class="tbBtn()"
    @click="isMobile ? triggerImageInput() : openSub('image')"
  >
    <v-remixicon name="riImageLine" />
  </button>
  <button
    v-if="isItemVisible('file')"
    v-keep-focus
    v-tooltip.group="translations.menu.file"
    :aria-label="translations.menu.file"
    :class="tbBtn()"
    @click="isMobile ? triggerFileInput() : openSub('file')"
  >
    <v-remixicon name="riFile2Line" />
  </button>
  <button
    v-if="isItemVisible('video')"
    v-keep-focus
    v-tooltip.group="translations.menu.video"
    :aria-label="translations.menu.video"
    :class="tbBtn()"
    @click="isMobile ? triggerVideoInput() : openSub('video')"
  >
    <v-remixicon name="riMovieLine" />
  </button>
  <button
    v-if="isItemVisible('table')"
    v-keep-focus
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
    v-keep-focus
    v-tooltip.group="translations.menu.draw"
    :aria-label="translations.menu.draw"
    :class="tbBtn(drawActions.some((action) => action.isActive))"
    @click="editor.chain().focus().insertPaper().run()"
  >
    <v-remixicon name="riBrushLine" />
  </button>

  <!-- Audio -->
  <div class="flex items-center gap-0.5">
    <button
      v-if="isItemVisible('audio')"
      v-keep-focus
      v-tooltip.group="translations.menu.record"
      :aria-label="translations.menu.record"
      :class="tbBtn()"
      @click="toggleRecording"
    >
      <v-remixicon name="riMicLine" />
    </button>
  </div>
</template>

<script>
export default {
  props: {
    editor: { type: Object, default: () => ({}) },
    translations: { type: Object, required: true },
    isItemVisible: { type: Function, required: true },
    isTableActive: { type: Boolean, default: false },
    tableActions: { type: Array, default: () => [] },
    drawActions: { type: Array, default: () => [] },
    toggleRecording: { type: Function, required: true },
    isMobile: { type: Boolean, default: false },
    tbBtn: { type: Function, required: true },
    openSub: { type: Function, required: true },
    openLinkPanel: { type: Function, required: true },
    triggerImageInput: { type: Function, required: true },
    triggerFileInput: { type: Function, required: true },
    triggerVideoInput: { type: Function, required: true },
  },
};
</script>
