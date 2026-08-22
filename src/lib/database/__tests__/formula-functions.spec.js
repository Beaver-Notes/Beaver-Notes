import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { FUNCS, NATIVE_LAZY, SIGNATURES } from '../formula-functions'

dayjs.extend(utc)

const ctx = {}
describe('formula-functions', () => {
  it('math + coercion', () => {
    expect(FUNCS.round.fn(ctx, 1.45)).toBe(1)
    expect(FUNCS.sum.fn(ctx, [1, 2], 3)).toBe(6)
    expect(FUNCS.toNumber.fn(ctx, '12.5')).toBe(12.5)
    expect(FUNCS.abs.fn(ctx, -3)).toBe(3)
  })
  it('text functions', () => {
    expect(FUNCS.length.fn(ctx, 'abc')).toBe(3)
    expect(FUNCS.upper.fn(ctx, 'ab')).toBe('AB')
    expect(FUNCS.contains.fn(ctx, 'hello', 'ell')).toBe(true)
    expect(FUNCS.format.fn(ctx, true)).toBe('true')
    expect(FUNCS.style.fn(ctx, 'x', 'red')).toEqual({ __styled: true, text: 'x', color: 'red' })
    expect(FUNCS.unstyle.fn(ctx, FUNCS.style.fn(ctx, 'x', 'red'))).toBe('x')
  })
  it('date functions operate on dayjs', () => {
    const d = dayjs('2026-03-15T10:30:00Z').utc(true)
    expect(FUNCS.year.fn(ctx, d)).toBe(2026)
    expect(FUNCS.month.fn(ctx, d)).toBe(2)
    expect(FUNCS.dateBetween.fn(ctx, dayjs('2026-01-10'), dayjs('2026-01-01'), 'days')).toBe(9)
    expect(FUNCS.dateAdd.fn(ctx, d, 1, 'month').month()).toBe(3)
    expect(typeof FUNCS.timestamp.fn(ctx, d)).toBe('number')
  })
  it('list functions', () => {
    expect(FUNCS.first.fn(ctx, [3, 1])).toBe(3)
    expect(FUNCS.join.fn(ctx, ['a', 'b'], '-')).toBe('a-b')
    expect(FUNCS.unique.fn(ctx, [1, 1, 2]).length).toBe(2)
    expect(FUNCS.includes.fn(ctx, [1, 2], 2)).toBe(true)
  })
  it('signatures cover catalog incl lazy names', () => {
    expect(SIGNATURES.if.args.length).toBe(3)
    for (const n of NATIVE_LAZY) expect(SIGNATURES[n]).toBeTruthy()
  })
})
