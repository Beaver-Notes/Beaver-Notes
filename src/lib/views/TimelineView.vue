<script setup>
import { computed } from 'vue'
import dayjs from 'dayjs'
import { runView, cellValue } from '../database/view-engine'
import { rawTimeDomain, layoutTimeline } from './timeline-layout'
import { useTranslations } from '@/composable/useTranslations'

const props = defineProps({ schema: Object, rows: Array, version: Number, view: Object })
const emit = defineEmits(['open-row'])

const { translations } = useTranslations()
const t = computed(() => translations.value.database || {})

const LANE_H = 32
const DAY = 86400000
const DATEISH = ['date', 'created_time', 'last_edited_time']
// canonical keys come from defaultViewConfig('timeline'); date fallback keeps
// hand-made configs rendering instead of blanking out (mirrors KanbanView)
const startColId = computed(
  () =>
    props.view?.config?.startColumnId ||
    props.schema.columns.find((c) => DATEISH.includes(c.type))?.id ||
    null
)
const endColId = computed(() => props.view?.config?.endColumnId || null)
const startCol = computed(() => props.schema.columns.find((c) => c.id === startColId.value) || null)

const swimlanes = computed(() => {
  void props.version
  const r = runView(props.schema, props.view, props.rows)
  const range = rawTimeDomain(r.rows, props.schema.columns, {
    startColumnId: startColId.value,
    endColumnId: endColId.value,
  })
  const opts = { startColumnId: startColId.value, endColumnId: endColId.value, range }
  const groups = r.groups || [{ key: null, label: '', color: 'gray', rows: r.rows }]
  return groups.map((g) => ({ ...g, ...layoutTimeline(g.rows, props.schema.columns, opts) }))
})

const ticks = computed(() => swimlanes.value[0]?.ticks || [])

function trackHeight(group) {
  return Math.max(1, ...group.lanes.map((b) => b.laneIndex + 1)) * LANE_H
}
function rangeLabel(bar) {
  const f = (ms) => dayjs(ms).format('MMM D')
  return `${bar.label}: ${f(bar.startMs)} – ${f(bar.endMs - DAY)}, ${dayjs(bar.startMs).format('YYYY')}`
}
</script>

<template>
  <div v-if="startCol" class="flex min-h-0 flex-1 flex-col overflow-auto p-3">
    <div class="min-w-max flex-1">
      <div
        data-test="axis"
        class="relative mb-2 h-6 border-b border-neutral-200 dark:border-neutral-700"
      >
        <span
          v-for="tick in ticks"
          :key="tick.ms"
          data-test="axis-tick"
          class="absolute top-0 whitespace-nowrap text-[11px] tabular-nums opacity-50"
          :style="{ left: `${tick.pct}%` }"
        >
          {{ tick.label }}
        </span>
      </div>

      <section
        v-for="g in swimlanes"
        :key="g.key ?? '_'"
        :data-test="g.label ? `swimlane-${g.label}` : undefined"
        :aria-label="g.label || undefined"
      >
        <header
          v-if="g.label"
          class="pt-3 text-xs font-semibold uppercase tracking-wide opacity-60"
        >
          {{ g.label }}
        </header>
        <div class="relative" :style="{ height: `${trackHeight(g)}px` }">
          <button
            v-for="bar in g.lanes"
            :key="bar.rowId"
            :data-test="`bar-${bar.rowId}`"
            type="button"
            class="absolute truncate rounded-md bg-primary/20 px-2 text-left text-xs transition-colors duration-150 hover:bg-primary/35 focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none dark:bg-primary/30 dark:hover:bg-primary/45"
            :style="{
              left: `${bar.leftPct}%`,
              width: `${bar.widthPct}%`,
              top: `${bar.laneIndex * LANE_H + 4}px`,
              height: `${LANE_H - 8}px`,
            }"
            :title="rangeLabel(bar)"
            :aria-label="rangeLabel(bar)"
            @click="emit('open-row', bar.rowId)"
          >
            {{ bar.label }}
          </button>
        </div>
      </section>
    </div>
  </div>
  <div v-else class="flex flex-1 items-center justify-center p-4 text-sm text-neutral-500">
    {{ t.noStartColumn || 'Add a date column to see items on the timeline' }}
  </div>
</template>
