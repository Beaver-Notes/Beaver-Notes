<script setup>
import { ref, watch } from 'vue'
import { richTextToPlain, plainToRichText } from '@/lib/database/rich-text-convert'

const props = defineProps({
  value: { type: null, default: null },
  kind: { type: String, default: 'rich_text' },
  editing: Boolean,
  name: { type: String, default: '' },
})
const emit = defineEmits(['commit'])

// ponytail: single-line input for all texty kinds; multi-line rich text if tables need wrapping cells
const RICH = ['title', 'rich_text']

const draft = ref(richTextToPlain(props.value))
watch(() => props.value, (v) => { if (!props.editing) draft.value = richTextToPlain(v) }, { deep: true })

function done(save) {
  const next = RICH.includes(props.kind) ? plainToRichText(draft.value) : draft.value
  // skip no-op/stale commits (blur firing after Enter would otherwise revert the edit)
  if (save && JSON.stringify(next) !== JSON.stringify(props.value ?? '')) emit('commit', next)
  draft.value = richTextToPlain(props.value)
}
</script>

<template>
  <input
    v-if="editing"
    v-model="draft"
    :aria-label="props.name"
    class="w-full bg-transparent px-2 py-1 text-sm outline-none focus:bg-input"
    @keydown.enter.prevent="done(true)"
    @keydown.esc.prevent="done(false)"
    @blur="done(true)"
  />
  <span v-else class="block truncate px-2 py-1 text-sm">{{ draft }}</span>
</template>
