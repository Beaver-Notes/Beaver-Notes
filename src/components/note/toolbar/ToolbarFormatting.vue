<template>
  <button
    v-for="item in visibleInlineFormatItems"
    :key="item.id"
    v-keep-focus
    v-tooltip.group="fmtMap[item.fmt]?.title"
    :aria-label="fmtMap[item.fmt]?.title"
    :class="tbBtn(editor.isActive(fmtMap[item.fmt]?.state))"
    @click="fmtMap[item.fmt]?.run()"
  >
    <v-remixicon :name="fmtMap[item.fmt]?.icon" />
  </button>

  <!-- Color/highlight entry: shows text color (icon) and highlight (bg) -->
  <button
    v-if="isItemVisible('color')"
    v-keep-focus
    v-tooltip.group="translations.menu.highlight"
    :aria-label="translations.menu.highlight"
    :class="tbBtn(editor.isActive('textStyle') || editor.isActive('highlight'))"
    :style="currentHighlightHex ? { backgroundColor: currentHighlightHex + '33' } : null"
    @click="openSub('color')"
  >
    <v-remixicon name="riFontColor" :style="{ color: currentTextColor || undefined }" />
  </button>
</template>

<script>
export default {
  props: {
    editor: { type: Object, default: () => ({}) },
    translations: { type: Object, required: true },
    fmtMap: { type: Object, required: true },
    visibleInlineFormatItems: { type: Array, required: true },
    isItemVisible: { type: Function, required: true },
    currentTextColor: { type: String, default: '' },
    currentHighlightHex: { type: String, default: null },
    tbBtn: { type: Function, required: true },
    openSub: { type: Function, required: true },
  },
};
</script>
