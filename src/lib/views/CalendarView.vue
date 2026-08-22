<script setup>
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import { runView, cellValue } from '../database/view-engine'
import { richTextToPlain } from '../database/rich-text-convert'
import { monthMatrix, isoDay, bucketByDay } from './calendar-grid'
import { useTranslations } from '@/composable/useTranslations'

const props = defineProps({ schema: Object, rows: Array, version: Number, view: Object })
const emit = defineEmits(['open-row', 'add-row-on-date'])

const { translations } = useTranslations()
const t = computed(() => translations.value.database || {})

const cursor = ref(dayjs().format('YYYY-MM-DD'))
const todayKey = dayjs().format('YYYY-MM-DD')
// locale-aware weekday initials without the weekdaysShort plugin
const weekdays = Array.from({ length: 7 }, (_, i) =>
  dayjs('2026-01-04').add(i, 'day').format('dd')
)

const monthLabel = computed(() => dayjs(cursor.value).format('MMMM YYYY'))
const days = computed(() => {
  void props.version
  return monthMatrix(cursor.value)
})

const dateCol = computed(
  () => props.schema.columns.find((c) => c.id === props.view?.config?.dateColumnId) || null
)
// ponytail: granularity config field is reserved; only 'month' renders for now
const viewRows = computed(() => {
  void props.version
  return runView(props.schema, props.view, props.rows).rows
})
const buckets = computed(() => bucketByDay(viewRows.value, dateCol.value, cursor.value))

function move(n) {
  cursor.value = dayjs(cursor.value).add(n, 'month').format('YYYY-MM-DD')
}
function goToday() {
  cursor.value = todayKey
}
function titleOf(row) {
  const col = props.schema.columns.find((c) => c.type === 'title')
  return col ? String(richTextToPlain(cellValue(col, row))) : ''
}
</script>

<template>
  <div v-if="dateCol" class="flex min-h-0 flex-1 flex-col p-3">
    <div class="mb-2 flex items-center gap-1">
      <h3 data-test="month-label" class="text-sm font-semibold">{{ monthLabel }}</h3>
      <div class="ml-auto flex items-center gap-1">
        <button
          data-test="today-btn"
          class="rounded-lg px-2 py-1 text-sm opacity-60 transition-colors duration-100 hover:bg-neutral-100 hover:opacity-100 dark:hover:bg-neutral-800"
          @click="goToday"
        >
          {{ t.today || 'Today' }}
        </button>
        <button data-test="prev-month" :aria-label="t.prevMonth || 'Previous month'" class="rounded-lg p-1.5 opacity-60 transition-colors duration-100 hover:bg-neutral-100 hover:opacity-100 dark:hover:bg-neutral-800" @click="move(-1)">
          <v-remixicon name="riArrowLeftSLine" size="16" />
        </button>
        <button data-test="next-month" :aria-label="t.nextMonth || 'Next month'" class="rounded-lg p-1.5 opacity-60 transition-colors duration-100 hover:bg-neutral-100 hover:opacity-100 dark:hover:bg-neutral-800" @click="move(1)">
          <v-remixicon name="riArrowRightSLine" size="16" />
        </button>
      </div>
    </div>

    <div class="grid grid-cols-7 text-center text-[11px] font-medium uppercase tracking-wide opacity-50">
      <span v-for="w in weekdays" :key="w">{{ w }}</span>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-y-auto border-t border-neutral-200 dark:border-neutral-700">
      <div
        v-for="d in days"
        :key="d.format('YYYY-MM-DD')"
        :data-test="`day-${d.format('YYYY-MM-DD')}`"
        class="min-h-[88px] border-b border-r border-neutral-200 p-1 transition-colors duration-150 last:border-r-0 dark:border-neutral-700 [&:nth-child(7n)]:border-r-0"
        :class="[
          d.month() !== dayjs(cursor).month() ? 'bg-neutral-50/70 dark:bg-neutral-800/30' : '',
          d.format('YYYY-MM-DD') === todayKey ? 'bg-primary/5' : '',
        ]"
      >
        <div
          data-test="day-body"
          role="button"
          tabindex="0"
          class="flex h-full cursor-pointer flex-col rounded-md outline-none focus-visible:ring-1 focus-visible:ring-primary"
          @click="emit('add-row-on-date', d.format('YYYY-MM-DD'))"
          @keydown.enter.prevent="emit('add-row-on-date', d.format('YYYY-MM-DD'))"
        >
          <span
            class="ml-auto flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums"
            :class="d.format('YYYY-MM-DD') === todayKey ? 'bg-primary font-semibold text-white' : ''"
          >
            {{ d.date() }}
          </span>
          <button
            v-for="r in buckets.get(d.format('YYYY-MM-DD')) || []"
            :key="r.id"
            class="mt-0.5 block w-full truncate rounded bg-primary/15 px-1.5 py-0.5 text-left text-xs transition-colors duration-150 hover:bg-primary/25"
            @click.stop="emit('open-row', r.id)"
          >
            {{ titleOf(r) }}
          </button>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="flex flex-1 items-center justify-center p-4 text-sm text-neutral-500">
    {{ t.noDateColumn || 'Add a date column to see items on the calendar' }}
  </div>
</template>
