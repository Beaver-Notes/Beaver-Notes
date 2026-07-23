<template>
  <!-- ── Text family: paragraph / headings / font size ── -->
  <template v-if="section === 'text'">
    <button
      v-if="isItemVisible('paragraph')"
      v-tooltip.group="translations.menu.paragraph"
      :aria-label="translations.menu.paragraph"
      :class="tbBtn(editor.isActive('paragraph'))"
      @click="openSub('paragraph')"
    >
      <v-remixicon name="riParagraph" />
    </button>

    <button
      v-if="isItemVisible('headings')"
      v-tooltip.group="translations.menu.headings"
      :aria-label="translations.menu.headings"
      :class="tbBtn(editor.isActive('heading'))"
      @click="openSub('headings')"
    >
      <v-remixicon name="riHeading" />
    </button>

    <button
      v-if="isItemVisible('fontSize')"
      v-tooltip.group="translations.menu.fontSize"
      :aria-label="translations.menu.fontSize"
      :class="tbBtn()"
      @click="openSub('fontSize')"
    >
      <span
        class="pointer-events-none text-xs font-semibold leading-none"
        >{{ fontSize || 'Aa' }}</span
      >
    </button>
  </template>

  <!-- ── Block family: lists / blockquote / code block ── -->
  <template v-else-if="section === 'block'">
    <button
      v-if="!isTableActive && isItemVisible('lists')"
      v-tooltip.group="translations.menu.lists"
      :aria-label="translations.menu.lists"
      :class="
        tbBtn(
          editor.isActive('orderedList') ||
            editor.isActive('bulletList') ||
            editor.isActive('taskList')
        )
      "
      @click="openSub('lists')"
    >
      <v-remixicon name="riListOrdered" />
    </button>

    <button
      v-if="!isTableActive && isItemVisible('blockquote')"
      v-tooltip.group="translations.menu.blockQuote"
      :aria-label="translations.menu.blockQuote"
      :class="tbBtn(editor.isActive('blockquote'))"
      @click="editor.chain().focus().toggleBlockquote().run()"
    >
      <v-remixicon name="riDoubleQuotesR" />
    </button>

    <button
      v-if="!isTableActive && isItemVisible('codeBlock')"
      v-tooltip.group="translations.menu.codeBlock"
      :aria-label="translations.menu.codeBlock"
      :class="tbBtn(editor.isActive('codeBlock'))"
      @click="editor.chain().focus().toggleCodeBlock().run()"
    >
      <v-remixicon name="riCodeBoxLine" />
    </button>
  </template>

  <!-- ── Actions family: delete / customize / custom items ── -->
  <template v-else-if="section === 'actions'">
    <button
      v-if="isItemVisible('delete')"
      v-tooltip.group="translations.menu.delete"
      :aria-label="translations.menu.delete"
      :class="[tbBtn(), 'hover:!text-red-500 hover:!bg-red-500/10']"
      @click="deleteNode"
    >
      <v-remixicon name="riDeleteBin6Line" />
    </button>

    <span
      v-if="isItemVisible('delete') || visibleItems.length"
      class="tb-divider"
    />

    <button
      v-tooltip.group="
        translations.toolbar?.customizeToolbar || 'Customize toolbar'
      "
      :aria-label="translations.toolbar?.customizeToolbar || 'Customize toolbar'"
      :class="tbBtn(showCustomizer)"
      @click="$emit('update:showCustomizer', true)"
    >
      <v-remixicon name="riSettings3Line" />
    </button>

    <template v-for="item in visibleItems" :key="item.id">
      <component
        :is="item.meta.component"
        v-if="item.meta?.component"
        :editor="editor"
      />
    </template>
  </template>
</template>

<script>
export default {
  emits: ['update:showCustomizer'],
  props: {
    section: { type: String, required: true },
    editor: { type: Object, default: () => ({}) },
    translations: { type: Object, required: true },
    isItemVisible: { type: Function, required: true },
    isTableActive: { type: Boolean, default: false },
    tbBtn: { type: Function, required: true },
    openSub: { type: Function, required: true },
    fontSize: { type: [Number, String], default: null },
    showCustomizer: { type: Boolean, default: false },
    deleteNode: { type: Function },
    visibleItems: { type: Array, default: () => [] },
  },
};
</script>
