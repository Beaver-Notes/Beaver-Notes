import { describe, it, expect } from 'vitest'
import { monthMatrix, isoDay, bucketByDay } from '../calendar-grid'

describe('monthMatrix', () => {
  it('returns a 6x7 grid starting on the first Sunday on/before the 1st', () => {
    const m = monthMatrix('2026-08-15')
    expect(m).toHaveLength(42)
    expect(m[0].format('YYYY-MM-DD')).toBe('2026-07-26')
    expect(m[0].format('ddd')).toBe('Sun')
    expect(m[41].format('YYYY-MM-DD')).toBe('2026-09-05')
  })

  it('contains every day of the month exactly once', () => {
    const m = monthMatrix('2026-08-15')
    const inMonth = m.filter((d) => d.month() === 7)
    expect(inMonth).toHaveLength(31)
  })
})

describe('isoDay', () => {
  it('reads plain ISO strings and {start} objects', () => {
    expect(isoDay('2026-08-05T10:00:00Z')).toBe('2026-08-05')
    expect(isoDay({ start: '2026-08-05', time_zone: null })).toBe('2026-08-05')
    expect(isoDay(null)).toBe(null)
    expect(isoDay(5)).toBe(null)
  })
})

describe('bucketByDay', () => {
  const column = { id: 'd', name: 'Date', type: 'date' }
  const rows = [
    { id: 'r1', cells: { d: { start: '2026-08-03' } } },
    { id: 'r2', cells: { d: '2026-08-03' } },
    { id: 'r3', cells: { d: { start: '2026-07-20' } } },
    { id: 'r4', cells: {} },
  ]

  it('buckets rows by their day key within the month grid', () => {
    const buckets = bucketByDay(rows, column, '2026-08-15')
    expect([...buckets.keys()].sort()).toEqual(['2026-08-03'])
    expect(buckets.get('2026-08-03').map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('skips rows outside the grid and rows without a date', () => {
    const buckets = bucketByDay(rows, column, '2026-08-15')
    expect(buckets.has('2026-07-20')).toBe(false)
    expect(buckets.has(null)).toBe(false)
  })

  it('returns an empty map when there is no date column', () => {
    expect(bucketByDay(rows, null, '2026-08-15').size).toBe(0)
  })
})
