import dayjs from 'dayjs'
import { cellValue } from '../database/view-engine'
import { richTextToPlain } from '../database/rich-text-convert'
import { isoDay } from './calendar-grid'

const DAY = 86400000

function msOf(v) {
  const day = isoDay(v)
  return day && dayjs(day).isValid() ? dayjs(day).valueOf() : null
}

// raw (unpadded) ms domain covered by all placeable rows; null when nothing fits
export function rawTimeDomain(rows, columns, { startColumnId, endColumnId }) {
  const startCol = columns.find((c) => c.id === startColumnId)
  if (!startCol) return null
  const endCol = endColumnId ? columns.find((c) => c.id === endColumnId) : null
  let min = Infinity
  let max = -Infinity
  for (const row of rows) {
    const startMs = msOf(cellValue(startCol, row))
    if (startMs == null) continue
    let endMs = endCol ? msOf(cellValue(endCol, row)) : null
    if (endMs == null || endMs < startMs + DAY) endMs = startMs + DAY
    min = Math.min(min, startMs)
    max = Math.max(max, endMs)
  }
  return min === Infinity ? null : { min, max }
}

function titleOf(row, columns) {
  const col = columns.find((c) => c.type === 'title')
  return col ? String(richTextToPlain(cellValue(col, row))) : ''
}

// Greedy lane packing + % positioning on a shared time scale. `range` (raw ms
// domain) pins multiple groups to one axis; without it the range is derived.
export function layoutTimeline(rows, columns, { startColumnId, endColumnId, range } = {}) {
  const startCol = columns.find((c) => c.id === startColumnId)
  if (!startCol) return { lanes: [], ticks: [], totalRange: null }
  const endCol = endColumnId ? columns.find((c) => c.id === endColumnId) : null

  const bars = []
  for (const row of rows) {
    const startMs = msOf(cellValue(startCol, row))
    if (startMs == null) continue
    let endMs = endCol ? msOf(cellValue(endCol, row)) : null
    if (endMs == null || endMs < startMs + DAY) endMs = startMs + DAY
    bars.push({ rowId: row.id, label: titleOf(row, columns), laneIndex: 0, startMs, endMs })
  }

  const domain =
    range ||
    (bars.length
      ? {
          min: Math.min(...bars.map((b) => b.startMs)),
          max: Math.max(...bars.map((b) => b.endMs)),
        }
      : null)
  if (!domain) return { lanes: [], ticks: [], totalRange: null }
  const pad = (domain.max - domain.min) * 0.05
  const lo = domain.min - pad
  const span = domain.max + pad - lo
  const pct = (ms) => Math.min(100, Math.max(0, ((ms - lo) / span) * 100))

  const sorted = [...bars].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const laneEnds = []
  for (const bar of sorted) {
    const idx = laneEnds.findIndex((end) => end <= bar.startMs)
    if (idx === -1) {
      laneEnds.push(bar.endMs)
      bar.laneIndex = laneEnds.length - 1
    } else {
      laneEnds[idx] = bar.endMs
      bar.laneIndex = idx
    }
    bar.leftPct = pct(bar.startMs)
    bar.widthPct = pct(bar.endMs) - bar.leftPct
  }

  const ticks = []
  let m = dayjs(lo).startOf('month')
  if (m.valueOf() < lo) m = m.add(1, 'month')
  for (; m.valueOf() <= lo + span; m = m.add(1, 'month')) {
    ticks.push({ ms: m.valueOf(), label: m.format('MMM YYYY'), pct: pct(m.valueOf()) })
  }

  return { lanes: bars, ticks, totalRange: { min: lo, max: lo + span } }
}
