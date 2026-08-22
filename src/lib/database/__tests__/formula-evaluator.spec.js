import { describe, it, expect } from 'vitest'
import { parse, evaluate, evaluateExpression, FormulaError, extractRefs } from '../formula-evaluator'

function ev(src, props = {}, extra = {}) {
  return evaluateExpression(src, { props, ...extra })
}
describe('formula-evaluator', () => {
  it('operators + precedence', () => {
    expect(ev('1 + 2 * 3')).toBe(7)
    expect(ev('(1+2)*3')).toBe(9)
    expect(ev('"a" + "b"')).toBe('ab')
    expect(ev('10 % 3')).toBe(1)
    expect(ev('-2 ^ 2')).toBe(-4) // unary binds tighter than ^
    expect(ev('2 < 3')).toBe(true)
    expect(ev('"a" != "b"')).toBe(true)
    expect(ev('true ? 1 : 2')).toBe(1)
  })
  it('logic short-circuit + not', () => {
    expect(ev('false and (1/0 > 1)')).toBe(false) // rhs unevaluated
    expect(ev('not false')).toBe(true)
    expect(ev('true or false')).toBe(true)
  })
  it('prop references resolve case-insensitively; missing → null', () => {
    expect(ev('prop("Due Date")', { 'due date': 5 })).toBe(5)
    expect(ev('prop("Nope")')).toBeNull()
  })
  it('if/ifs/let/lets', () => {
    expect(ev('if(prop("Done"), "yes", "no")', { Done: true })).toBe('yes')
    expect(ev('ifs(false, 1, false, 2, "else")')).toBe('else')
    expect(ev('let("x", 5, x * 2)')).toBe(10)
    expect(ev('lets("a", 1, "b", a + 1, a + b)')).toBe(3)
  })
  it('lists + lambdas bind current/index', () => {
    expect(ev('[1,2,3].first()')).toBe(1)
    expect(ev('sum([1,2,3])')).toBe(6)
    expect(ev('filter([1,2,3,4], current > 2)')).toEqual([3,4])
    expect(ev('map([1,2], current * index)').join(',')).toBe('0,2')
    expect(ev('some([1,2], current == 2)')).toBe(true)
    expect(ev('find([1,2], current > 1)')).toBe(2)
  })
  it('dates + style wrappers', () => {
    expect(ev('formatDate(parseDate("2026-01-05"), "YYYY")')).toBe('2026')
    expect(ev('dateBetween(parseDate("2026-01-10"), parseDate("2026-01-01"), "days")')).toBe(9)
    const styled = ev('style("hi", "red")')
    expect(styled).toEqual({ __styled:true, text:'hi', color:'red' })
    expect(ev('unstyle(style("hi", "red"))')).toBe('hi')
  })
  it('errors are friendly + bounded', () => {
    expect(() => parse('1 +')).toThrow(FormulaError)
    expect(() => ev('nopeFn(1)')).toThrow(/Unknown function/)
    expect(() => ev('let("a",1,a) + missingVar')).not.toThrow() // missing var resolves null→0
    const deep = '['.repeat(200) + ']'.repeat(200)
    expect(() => evaluate(parse(deep), { props:{} })).toThrow(FormulaError)
    const big = '(1+'.repeat(6000) + '1' + ')'.repeat(6000)
    expect(() => ev(big)).toThrow(FormulaError)
  })
  it('extractRefs finds prop names', () => {
    expect([...extractRefs('if(prop("A") > prop("B"), now(), today())')].sort()).toEqual(['A','B'])
  })
  it('mixed date↔string ordering comparisons yield null', () => {
    expect(ev('"2026-01-05" < now()')).toBeNull()
    expect(ev('now() < "2026-01-05"')).toBeNull()
    expect(ev('now() < now()')).toBe(false) // date↔date still orders
  })
  it('inherited FUNCS members are unknown functions', () => {
    let err
    try { ev('[1].constructor()') } catch (e) { err = e }
    expect(err).toBeInstanceOf(FormulaError)
    expect(err.message).toMatch(/Unknown function/)
  })
})
