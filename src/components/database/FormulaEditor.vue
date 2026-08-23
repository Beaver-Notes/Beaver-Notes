<script setup>
import { ref, computed } from 'vue'
import { useTranslations } from '@/composable/useTranslations'
import { SIGNATURES } from '@/lib/database/formula-functions'
import { parse, evaluateExpression } from '@/lib/database/formula-evaluator'
import { useFormulaGenerator } from '@/composable/useFormulaGenerator'

const props = defineProps({
  column: { type: Object, required: true },
  schema: { type: Object, required: true },
  rows: { type: Array, default: () => [] },
})
const emit = defineEmits(['save', 'cancel'])

const { translations } = useTranslations()
const t = computed(() => translations.value.database || {})

const { describe: generateFromDescription, busy } = useFormulaGenerator()

const mode = ref(props.column.config?.expression ? 'expression' : 'describe')
const draft = ref(props.column.config?.expression || '')
const description = ref('')
const generated = ref(null)
const genError = ref(false)
const exprEl = ref(null)

const otherColumns = computed(() =>
  (props.schema.columns || []).filter((c) => c.id !== props.column.id && c.name),
)

const error = computed(() => {
  if (!draft.value.trim()) return null
  try {
    parse(draft.value)
    return null
  } catch (e) {
    return { message: e.message, position: e.position }
  }
})
const canSave = computed(() => Boolean(draft.value.trim()) && !error.value)

// ponytail: plain cell values as-is; date/rich-text coercion parity with compute-row when previews mislead
const previewProps = () => {
  const row = props.rows[0]
  const out = {}
  if (!row) return out
  for (const c of otherColumns.value) out[c.name] = row.cells?.[c.id] ?? null
  return out
}
const preview = computed(() => {
  if (!props.rows.length || !canSave.value) return null
  try {
    const v = evaluateExpression(draft.value, { props: previewProps() })
    return v == null ? '' : String(v)
  } catch {
    return null
  }
})

// ---- autocomplete
const AC_LIMIT = 8
const ac = ref({ open: false, items: [], index: 0, start: 0, end: 0, kind: '' })
const closeAc = () => (ac.value.open = false)

function refreshAc(el) {
  const caret = el.selectionStart ?? el.value.length
  const before = el.value.slice(0, caret)
  let m = /prop\(\s*"([^"]*)$/.exec(before)
  if (m) {
    const q = m[1].toLowerCase()
    const items = otherColumns.value
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, AC_LIMIT)
      .map((c) => ({ label: c.name, kind: 'prop', detail: c.type }))
    if (!items.length) return closeAc()
    ac.value = { open: true, index: 0, start: caret - m[1].length, end: caret, kind: 'prop', items }
    return
  }
  m = /(^|[^.\w])([A-Za-z_][A-Za-z0-9_]*)$/.exec(before)
  if (!m || !m[2]) return closeAc()
  const q = m[2].toLowerCase()
  const cols = otherColumns.value
    .filter((c) => c.name.toLowerCase().includes(q))
    .map((c) => ({ label: c.name, kind: 'col', detail: c.type }))
  const fns = Object.keys(SIGNATURES)
    .filter((f) => f.toLowerCase().includes(q))
    .map((f) => ({
      label: f,
      kind: 'fn',
      detail: `(${SIGNATURES[f].args.join(', ')}) → ${SIGNATURES[f].returns}`,
    }))
  const items = [...cols, ...fns]
  if (!items.length) return closeAc()
  ac.value = { open: true, index: 0, start: caret - m[2].length, end: caret, kind: 'ident', items: items.slice(0, AC_LIMIT) }
}

function applyAc(item) {
  const el = exprEl.value
  if (!el || !ac.value.open) return
  const repl =
    ac.value.kind === 'prop'
      ? `${item.label}")`
      : item.kind === 'col'
        ? `prop("${item.label}")`
        : `${item.label}(`
  el.value = el.value.slice(0, ac.value.start) + repl + el.value.slice(ac.value.end)
  draft.value = el.value
  const caret = ac.value.start + repl.length
  el.setSelectionRange(caret, caret)
  closeAc()
}

function onExprInput(e) {
  refreshAc(e.target)
}
function onExprKeydown(e) {
  if (!ac.value.open) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    ac.value.index = (ac.value.index + 1) % ac.value.items.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    ac.value.index = (ac.value.index - 1 + ac.value.items.length) % ac.value.items.length
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    applyAc(ac.value.items[ac.value.index])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    escSwallowed.value = true
    closeAc()
  }
}
// ui-modal closes on a window-level Escape keyup; swallow the one this keydown caused
const escSwallowed = ref(false)
function onExprKeyup(e) {
  if (escSwallowed.value && e.code === 'Escape') {
    escSwallowed.value = false
    e.stopPropagation()
  }
}

// ---- describe pane
async function generate() {
  genError.value = false
  try {
    const res = await generateFromDescription(description.value, props.schema.columns || [])
    generated.value = res?.formula || null
    genError.value = !generated.value
  } catch {
    generated.value = null
    genError.value = true
  }
}
function insertGenerated() {
  if (!generated.value) return
  draft.value = generated.value
  mode.value = 'expression'
}
</script>

<template>
  <ui-modal :model-value="true" content-class="max-w-xl" @close="emit('cancel')">
    <template #header>
      <h3 class="text-base font-semibold">
        {{ t.formulaTitle || 'Edit formula' }}
        <span class="font-normal opacity-50">{{ column.name }}</span>
      </h3>
    </template>

    <div class="mt-3 flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
      <button
        data-test="mode-describe"
        :data-active="mode === 'describe'"
        :aria-label="t.modeDescribe || 'Describe'"
        class="flex-1 rounded-md px-3 py-1 text-sm transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        :class="mode === 'describe' ? 'bg-white font-medium shadow-sm dark:bg-neutral-700' : 'opacity-60 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60'"
        @click="mode = 'describe'"
      >
        {{ t.modeDescribe || 'Describe' }}
      </button>
      <button
        data-test="mode-expression"
        :data-active="mode === 'expression'"
        :aria-label="t.modeExpression || 'Expression'"
        class="flex-1 rounded-md px-3 py-1 text-sm transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        :class="mode === 'expression' ? 'bg-white font-medium shadow-sm dark:bg-neutral-700' : 'opacity-60 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60'"
        @click="mode = 'expression'"
      >
        {{ t.modeExpression || 'Expression' }}
      </button>
    </div>

    <div v-if="mode === 'expression'" class="mt-3">
      <div class="relative">
      <textarea
        ref="exprEl"
        v-model="draft"
        data-test="expression-input"
        rows="4"
        spellcheck="false"
        :aria-label="t.formulaTitle || 'Edit formula'"
        class="w-full resize-y rounded-lg border bg-transparent p-2 font-mono text-sm transition-colors duration-100 focus:outline-none focus:ring-2"
        :class="
          error
            ? 'border-red-500 focus:ring-red-500/30 dark:border-red-500'
            : 'border-neutral-200 focus:border-primary focus:ring-primary/30 dark:border-neutral-700'
        "
        @input="onExprInput"
        @keydown="onExprKeydown"
        @keyup="onExprKeyup"
        @blur="closeAc"
      />
      </div>
      <transition name="fade">
        <ul
          v-if="ac.open"
          data-test="autocomplete"
          role="listbox"
          class="absolute z-10 mt-1 max-h-48 w-64 overflow-auto rounded-lg border border-neutral-200 bg-white py-1 opacity-100 shadow-lg duration-150 dark:border-neutral-700 dark:bg-neutral-800"
        >
          <li
            v-for="(it, i) in ac.items"
            :key="it.kind + it.label"
            role="option"
            :aria-selected="i === ac.index"
            :data-test="`ac-${it.label}`"
            class="flex cursor-pointer items-center justify-between gap-3 px-2 py-1.5 text-sm transition-colors duration-100"
            :class="i === ac.index ? 'bg-neutral-100 dark:bg-neutral-700' : ''"
            @mousedown.prevent="applyAc(it)"
            @mousemove="ac.index = i"
          >
            <span class="truncate font-mono">{{ it.label }}</span>
            <span class="shrink-0 truncate text-xs opacity-50">{{ it.detail }}</span>
          </li>
        </ul>
      </transition>
      <p
        v-if="error"
        data-test="formula-error"
        role="alert"
        class="mt-1 text-xs text-red-600 dark:text-red-400"
      >
        {{ error.message }}<template v-if="error.position != null"> ({{ t.positionAt || 'position' }} {{ error.position }})</template>
      </p>
      <div
        v-else-if="preview != null"
        data-test="formula-preview"
        class="mt-2 flex items-baseline gap-2 rounded-lg bg-neutral-50 px-2 py-1.5 dark:bg-neutral-800/60"
      >
        <span class="shrink-0 text-xs font-medium uppercase tracking-wide opacity-50">{{ t.preview || 'Preview' }}</span>
        <span class="truncate font-mono text-sm">{{ preview }}</span>
      </div>
    </div>

    <div v-else class="mt-3 space-y-2">
      <textarea
        v-model="description"
        data-test="describe-input"
        rows="3"
        :placeholder="t.describePlaceholder || 'Describe what this formula should calculate…'"
        :aria-label="t.modeDescribe || 'Describe'"
        class="w-full resize-y rounded-lg border border-neutral-200 bg-transparent p-2 text-sm transition-colors duration-100 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-neutral-700"
      />
      <div class="flex items-center gap-2">
        <button
          data-test="generate"
          :disabled="busy"
          class="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm transition-colors duration-100 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="generate"
        >
          {{ generated || genError ? t.retry || 'Retry' : t.generate || 'Generate formula' }}
        </button>
        <p v-if="genError" data-test="generate-error" role="alert" class="text-xs text-red-600 dark:text-red-400">
          {{ t.couldNotGenerate || "Couldn't generate a formula. Try rephrasing." }}
        </p>
      </div>
      <pre
        v-if="generated"
        data-test="generated-formula"
        class="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-neutral-50 p-2 font-mono text-sm dark:bg-neutral-800/60"
      >{{ generated }}</pre>
      <button
        v-if="generated"
        data-test="insert-generated"
        class="rounded-lg px-3 py-1.5 text-sm font-medium text-primary transition-colors duration-100 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        @click="insertGenerated"
      >
        {{ t.insertIntoExpression || 'Insert into expression' }}
      </button>
    </div>

    <template #actions>
      <div class="mt-4 flex justify-end gap-2">
        <button
          data-test="cancel"
          class="rounded-lg px-3 py-1.5 text-sm transition-colors duration-100 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:bg-neutral-800"
          @click="emit('cancel')"
        >
          {{ t.cancel || 'Cancel' }}
        </button>
        <button
          data-test="save"
          :disabled="!canSave"
          class="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity duration-100 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
          @click="canSave && emit('save', draft)"
        >
          {{ t.save || 'Save' }}
        </button>
      </div>
    </template>
  </ui-modal>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--motion-fast, 120ms) var(--ease-standard, ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
