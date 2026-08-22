import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { rawTimeDomain, layoutTimeline } from '../timeline-layout'

const columns = [
  { id: 't', name: 'Name', type: 'title' },
  { id: 'd', name: 'Start', type: 'date' },
  { id: 'e', name: 'End', type: 'date' },
  { id: 'c', name: 'Created', type: 'created_time' },
]
const opts = { startColumnId: 'd', endColumnId: 'e' }
const DAY = 86400000
const ms = (iso) => dayjs(iso).valueOf()
const row = (id, title, start, end, extra = {}) => ({
  id,
  ...extra,
  cells: {
    t: [{ type: 'text', text: title }],
    ...(start ? { d: { start } } : {}),
    ...(end ? { e: { start: end } } : {}),
    ...extra.cells,
  },
})

describe('rawTimeDomain', () => {
  it('spans every bar including auto-extended missing ends', () => {
    const rows = [row('r1', 'A', '2026-08-03', '2026-08-04'), row('r2', 'B', '2026-08-10')]
    expect(rawTimeDomain(rows, columns, opts)).toEqual({
      min: ms('2026-08-03'),
      max: ms('2026-08-10') + DAY,
    })
  })

  it('is null without a start column or valid rows', () => {
    expect(rawTimeDomain([], columns, opts)).toBe(null)
    expect(rawTimeDomain([row('r1', 'A', '2026-08-03')], columns, { startColumnId: 'x' })).toBe(null)
  })
})

describe('layoutTimeline', () => {
  it('packs overlapping bars into distinct lanes, reusing freed ones', () => {
    const rows = [
      row('r1', 'A', '2026-08-03', '2026-08-05'),
      row('r2', 'B', '2026-08-04', '2026-08-06'),
      row('r3', 'C', '2026-08-06', '2026-08-08'),
    ]
    const lanes = layoutTimeline(rows, columns, opts).lanes
    const byId = Object.fromEntries(lanes.map((b) => [b.rowId, b]))
    expect(byId.r1.laneIndex).toBe(0)
    expect(byId.r2.laneIndex).toBe(1)
    expect(byId.r3.laneIndex).toBe(0)
  })

  it('defaults a missing or inverted end to start + 1 day', () => {
    const rows = [row('r1', 'A', '2026-08-03'), row('r2', 'B', '2026-08-03', '2026-08-01')]
    const lanes = layoutTimeline(rows, columns, opts).lanes
    for (const b of lanes) expect(b.endMs - b.startMs).toBe(DAY)
  })

  it('skips rows without a start date', () => {
    const rows = [row('r1', 'A', '2026-08-03', '2026-08-05'), row('r2', 'B')]
    expect(layoutTimeline(rows, columns, opts).lanes.map((b) => b.rowId)).toEqual(['r1'])
  })

  it('labels bars with the plain title text', () => {
    const lanes = layoutTimeline([row('r1', 'Alpha', '2026-08-03')], columns, opts).lanes
    expect(lanes[0].label).toBe('Alpha')
  })

  it('keeps pct math inside 0–100 and pads the range on both sides', () => {
    const rows = [
      row('r1', 'A', '2026-08-03', '2026-08-05'),
      row('r2', 'B', '2026-09-01', '2026-09-04'),
    ]
    const lanes = layoutTimeline(rows, columns, opts).lanes
    const byId = Object.fromEntries(lanes.map((b) => [b.rowId, b]))
    for (const b of lanes) {
      expect(b.leftPct).toBeGreaterThanOrEqual(0)
      expect(b.leftPct).toBeLessThanOrEqual(100)
      expect(b.widthPct).toBeGreaterThan(0)
      expect(b.leftPct + b.widthPct).toBeLessThanOrEqual(100)
    }
    expect(byId.r1.leftPct).toBeGreaterThan(0)
    expect(byId.r2.leftPct + byId.r2.widthPct).toBeLessThan(100)
  })

  it('emits month ticks between the padded bounds', () => {
    const rows = [row('r1', 'A', '2026-08-15', '2026-10-10')]
    const { ticks } = layoutTimeline(rows, columns, opts)
    expect(ticks.map((t) => t.label)).toEqual(['Sep 2026', 'Oct 2026'])
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].pct).toBeGreaterThan(ticks[i - 1].pct)
  })

  it('reads created_time columns via cellValue', () => {
    const rows = [
      { id: 'r1', createdAt: '2026-08-03T10:00:00Z', cells: { t: [{ type: 'text', text: 'A' }] } },
    ]
    const { lanes } = layoutTimeline(rows, columns, { startColumnId: 'c' })
    expect(lanes[0].startMs).toBe(ms('2026-08-03'))
    expect(lanes[0].endMs).toBe(ms('2026-08-03') + DAY)
  })

  it('a shared range pins every group to the same scale', () => {
    const range = rawTimeDomain(
      [row('r1', 'A', '2026-08-03', '2026-08-05'), row('r2', 'B', '2026-09-01')],
      columns,
      opts
    )
    const a = layoutTimeline([row('r1', 'A', '2026-08-03', '2026-08-05')], columns, { ...opts, range })
    const b = layoutTimeline([row('r2', 'B', '2026-09-01')], columns, { ...opts, range })
    expect(a.totalRange).toEqual(b.totalRange)
    expect(a.ticks.length).toBeGreaterThan(0)
    expect(a.ticks).toEqual(b.ticks)
  })

  it('returns an empty layout when nothing can be placed', () => {
    expect(layoutTimeline([], columns, opts)).toEqual({ lanes: [], ticks: [], totalRange: null })
  })
})
