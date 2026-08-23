import { describe, it, expect } from 'vitest'
import { computeRollup } from '../rollup-engine'

const nums = [4, null, 7, 4, '']
const dates = [{ start: '2026-01-03' }, '2026-01-01', '2026-03-09', null]
const boxes = [true, false, true, null]

describe('computeRollup counts', () => {
  it('count_all counts every related row', () => {
    expect(computeRollup(nums, { function: 'count_all' })).toBe(5)
  })

  it('count_values counts non-empty', () => {
    expect(computeRollup(nums, { function: 'count_values' })).toBe(3)
  })

  it('count_unique_values dedupes non-empty', () => {
    expect(computeRollup([1, 1, 2, '', null], { function: 'count_unique_values' })).toBe(2)
  })

  it('count_empty / count_not_empty split the set', () => {
    expect(computeRollup(nums, { function: 'count_empty' })).toBe(2)
    expect(computeRollup(nums, { function: 'count_not_empty' })).toBe(3)
  })
})

describe('computeRollup percentages', () => {
  it('percent_empty / percent_not_empty round to integers', () => {
    expect(computeRollup(nums, { function: 'percent_empty' })).toBe(40)
    expect(computeRollup(nums, { function: 'percent_not_empty' })).toBe(60)
    expect(computeRollup([1, 2, 3], { function: 'percent_empty' })).toBe(0)
    expect(computeRollup(['', '', 1], { function: 'percent_not_empty' })).toBe(33)
  })

  it('percents of empty input are null', () => {
    expect(computeRollup([], { function: 'percent_empty' })).toBeNull()
    expect(computeRollup([], { function: 'percent_not_empty' })).toBeNull()
    expect(computeRollup([], { function: 'percent_checked' })).toBeNull()
    expect(computeRollup([], { function: 'percent_unchecked' })).toBeNull()
  })
})

describe('computeRollup numeric functions', () => {
  it('sum ignores empties and non-numeric', () => {
    expect(computeRollup(nums, { function: 'sum' })).toBe(15)
    expect(computeRollup([0], { function: 'sum' })).toBe(0)
  })

  it('average over non-empty numbers', () => {
    expect(computeRollup(nums, { function: 'average' })).toBe(5)
  })

  it('median odd takes middle, even averages middles', () => {
    expect(computeRollup([1, 3, 10], { function: 'median' })).toBe(3)
    expect(computeRollup([1, 2, 3, 4], { function: 'median' })).toBe(2.5)
  })

  it('min, max, range over non-empty numbers', () => {
    expect(computeRollup(nums, { function: 'min' })).toBe(4)
    expect(computeRollup(nums, { function: 'max' })).toBe(7)
    expect(computeRollup(nums, { function: 'range' })).toBe(3)
  })

  it('numeric fns ignore all-non-numeric input and null on none', () => {
    expect(computeRollup(['a', ''], { function: 'sum' })).toBeNull()
    expect(computeRollup(['a', ''], { function: 'min' })).toBeNull()
  })

  it('numeric fns null on empty input', () => {
    for (const fn of ['sum', 'average', 'median', 'min', 'max', 'range']) {
      expect(computeRollup([], { function: fn })).toBeNull()
    }
  })
})

describe('computeRollup date functions', () => {
  it('earliest_date / latest_date pick parseable extremes', () => {
    expect(computeRollup(dates, { function: 'earliest_date' })).toBe('2026-01-01')
    expect(computeRollup(dates, { function: 'latest_date' })).toBe('2026-03-09')
  })

  it('date_range joins earliest → latest', () => {
    expect(computeRollup(dates, { function: 'date_range' })).toBe('2026-01-01 → 2026-03-09')
  })

  it('date fns null without any valid date', () => {
    for (const fn of ['earliest_date', 'latest_date', 'date_range']) {
      expect(computeRollup(['nope', null], { function: fn })).toBeNull()
      expect(computeRollup([], { function: fn })).toBeNull()
    }
  })
})

describe('computeRollup checkbox functions', () => {
  it('checked / unchecked count booleans', () => {
    expect(computeRollup(boxes, { function: 'checked' })).toBe(2)
    expect(computeRollup(boxes, { function: 'unchecked' })).toBe(2)
  })

  it('percent_checked / percent_unchecked round over all rows', () => {
    expect(computeRollup(boxes, { function: 'percent_checked' })).toBe(50)
    expect(computeRollup(boxes, { function: 'percent_unchecked' })).toBe(50)
  })

  it('checkbox counts are 0 on empty input', () => {
    expect(computeRollup([], { function: 'checked' })).toBe(0)
    expect(computeRollup([], { function: 'unchecked' })).toBe(0)
  })
})

describe('computeRollup misc', () => {
  it('show_original returns values as-is', () => {
    const v = [1, 'a', null]
    expect(computeRollup(v, { function: 'show_original' })).toEqual(v)
  })

  it('count_per_group counts each distinct value', () => {
    expect(computeRollup(['a', 'b', 'a', 'a'], { function: 'count_per_group' }))
      .toEqual({ a: 3, b: 1 })
  })

  it('counts are 0 on empty input', () => {
    for (const fn of ['count_all', 'count_values', 'count_unique_values', 'count_empty', 'count_not_empty']) {
      expect(computeRollup([], { function: fn })).toBe(0)
    }
  })

  it('unknown function yields null', () => {
    expect(computeRollup([1], { function: 'nope' })).toBeNull()
  })
})
