import { describe,it,expect } from 'vitest'
import { NUMBER_FORMATS, formatNumber, parseNumberInput } from '../number-format'

describe('number-format', () => {
  it('exposes available formats', () => {
    expect(NUMBER_FORMATS).toContain('plain')
  })
  it('formats plain and comma', () => {
    expect(formatNumber(1234.5, 'plain')).toMatch(/1234\.5/)
    expect(formatNumber(1234.5, 'comma')).toBe(new Intl.NumberFormat().format(1234.5))
  })
  it('formats percent and currency', () => {
    expect(formatNumber(0.25, 'percent')).toContain('25')
    expect(formatNumber(9, 'dollar')).toContain('$')
    expect(formatNumber(9, 'euro')).toContain('€')
  })
  it('returns empty string for empty values and parses user input', () => {
    expect(formatNumber(null, 'plain')).toBe('')
    expect(formatNumber('', 'plain')).toBe('')
    expect(parseNumberInput('$1,234.56')).toBeCloseTo(1234.56)
    expect(parseNumberInput('abc')).toBeNull()
  })
})
