<template>
  <!-- Inline text-formatting buttons (bold / italic / underline / strike / inline code) -->
  <button
    v-for="item in visibleInlineFormatItems"
    :key="item.id"
    v-tooltip.group="fmtMap[item.fmt]?.title"
    :aria-label="fmtMap[item.fmt]?.title"
    :class="tbBtn(editor.isActive(fmtMap[item.fmt]?.state))"
    @click="fmtMap[item.fmt]?.run()"
  >
    <v-remixicon :name="fmtMap[item.fmt]?.icon" />
  </button>

  <!-- Color / highlight entry button -->
  <button
    v-if="isItemVisible('color')"
    v-tooltip.group="translations.menu.highlight"
    :aria-label="translations.menu.highlight"
    :class="tbBtn(editor.isActive('textStyle') || editor.isActive('highlight'))"
    @click="openSub('color')"
  >
    <v-remixicon name="riFontColor" :style="{ color: currentTextColor }" />
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
    tbBtn: { type: Function, required: true },
    openSub: { type: Function, required: true },
  },
};
</script>
