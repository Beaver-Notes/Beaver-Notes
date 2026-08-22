import dayjs from 'dayjs'
import { cellValue } from '../database/view-engine'

// 6x7 month grid; week starts Sunday (dayjs default locale)
export function monthMatrix(cursor) {
  const start = dayjs(cursor).startOf('month').startOf('week')
  return Array.from({ length: 42 }, (_, i) => start.add(i, 'day'))
}

export function isoDay(value) {
  const s = typeof value === 'string' ? value : value?.start
  return typeof s === 'string' ? s.slice(0, 10) : null
}

// bucket rows under their YYYY-MM-DD key, keeping only days inside the cursor's grid
export function bucketByDay(rows, column, cursor) {
  const buckets = new Map()
  if (!column) return buckets
  const days = monthMatrix(cursor)
  const firstKey = days[0].format('YYYY-MM-DD')
  const lastKey = days[days.length - 1].format('YYYY-MM-DD')
  for (const row of rows) {
    const key = isoDay(cellValue(column, row))
    if (!key || key < firstKey || key > lastKey) continue
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(row)
  }
  return buckets
}
