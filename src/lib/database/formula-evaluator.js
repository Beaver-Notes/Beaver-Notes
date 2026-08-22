// src/lib/database/formula-evaluator.js
import dayjs from 'dayjs'
import { FUNCS, unstyled } from './formula-functions'

export class FormulaError extends Error {
  constructor(message, position = null) { super(message); this.name = 'FormulaError'; this.position = position }
}

const MAX_STEPS = 10000
const MAX_DEPTH = 200
const PARSE_MAX_DEPTH = 500 // parse-side guard: keeps recursion off the JS stack; eval enforces MAX_DEPTH

const KEYWORDS = new Set(['true','false','and','or','not','let','lets','current','index'])

// ---- Tokenizer
export function tokenize(src) {
  const tokens = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '"') {
      let j = i + 1, out = ''
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) { out += src[j + 1]; j += 2 }
        else out += src[j++]
      }
      if (j >= src.length) throw new FormulaError('Unterminated string literal', i)
      tokens.push({ t:'str', v:out, pos:i }); i = j + 1; continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < src.length && /[0-9._]/.test(src[j])) j++
      tokens.push({ t:'num', v: parseFloat(src.slice(i, j).replace(/_/g, '')), pos:i }); i = j; continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++
      tokens.push({ t:'ident', v: src.slice(i, j), pos:i }); i = j; continue
    }
    const two = src.slice(i, i + 2)
    if (two === '==' || two === '!=' || two === '>=' || two === '<=' || two === '&&' || two === '||') { tokens.push({ t:'op', v:two, pos:i }); i += 2; continue }
    if ('+-*/%^<>()[]{},.:?!'.includes(ch)) { tokens.push({ t:'op', v:ch, pos:i }); i++; continue }
    throw new FormulaError(`Unexpected character "${ch}"`, i)
  }
  tokens.push({ t:'eof', v:null, pos:src.length })
  return tokens
}

// ---- Parser (Pratt)
const BINARY = {
  or:1, '||':1, and:2, '&&':2,
  '==':3, '!=':3, '<':4, '>':4, '<=':4, '>=':4,
  '+':5, '-':5, '*':6, '/':6, '%':6, '^':8,
}
const RIGHT_ASSOC = new Set(['^'])
const COMPARISONS = new Set(['==','!=','<','>','<=','>='])

export function parse(src) {
  const tokens = tokenize(src)
  let pos = 0
  let depth = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expectOp = (op) => {
    const tk = next()
    if (tk.t !== 'op' || tk.v !== op) throw new FormulaError(`Expected "${op}"`, tk.pos)
  }
  function parseArgs() {
    expectOp('(')
    const args = []
    if (!(peek().t === 'op' && peek().v === ')')) {
      do { args.push(parseExpr()) } while (peek().t === 'op' && peek().v === ',' && (next(), true))
    }
    expectOp(')')
    return args
  }
  function parsePostfix(node) {
    for (;;) {
      const tk = peek()
      if (!(tk.t === 'op' && tk.v === '.')) return node
      next()
      const nameTk = next()
      if (nameTk.t !== 'ident') throw new FormulaError('Expected property or method after "."', nameTk.pos)
      if (peek().t === 'op' && peek().v === '(') node = { k:'call', name:nameTk.v, args:[node, ...parseArgs()] }
      else throw new FormulaError(`Unknown member "${nameTk.v}"`, nameTk.pos)
    }
  }
  function parsePrimary(tk) {
    if (tk.t === 'num' || tk.t === 'str') return { k:'lit', v:tk.v }
    if (tk.t === 'op' && tk.v === '(') { const e = parseExpr(); expectOp(')'); return e }
    if (tk.t === 'op' && tk.v === '[') {
      const items = []
      if (!(peek().t === 'op' && peek().v === ']')) {
        do { items.push(parseExpr()) } while (peek().t === 'op' && peek().v === ',' && (next(), true))
      }
      expectOp(']')
      return { k:'list', items }
    }
    if (tk.t === 'ident') {
      if (KEYWORDS.has(tk.v)) {
        if (tk.v === 'true') return { k:'lit', v:true }
        if (tk.v === 'false') return { k:'lit', v:false }
        if (tk.v === 'current') return { k:'current' }
        if (tk.v === 'index') return { k:'index' }
        if (tk.v === 'and' || tk.v === 'or' || tk.v === 'not') throw new FormulaError(`"${tk.v}" connects two expressions and cannot start one`, tk.pos)
        return { k:'call', name:tk.v, args:parseArgs() } // let/lets consume arg lists
      }
      if (peek().t === 'op' && peek().v === '(') return { k:'call', name:tk.v, args:parseArgs() }
      if (tk.v === 'e' || tk.v === 'pi') return { k:'lit', v: tk.v === 'e' ? Math.E : Math.PI }
      return { k:'var', name:tk.v } // let/lets-bound variable; unbound resolves to null
    }
    throw new FormulaError('Unexpected token', tk.pos)
  }
  function parseExprInner(minPrec) {
    let left
    const tk = next()
    const isPrefixNot = tk.t === 'ident' && tk.v === 'not'
    if ((tk.t === 'op' && (tk.v === '-' || tk.v === '!')) || isPrefixNot) {
      left = { k:'unary', op: isPrefixNot ? 'not' : tk.v, arg: parseExpr(7), pos: tk.pos }
    } else {
      left = parsePostfix(parsePrimary(tk))
    }
    for (;;) {
      const opTk = peek()
      const isWordOp = opTk.t === 'ident' && (opTk.v === 'and' || opTk.v === 'or')
      if (!(opTk.t === 'op' && BINARY[opTk.v]) && !isWordOp) break
      const op = opTk.v
      const prec = BINARY[op]
      if (prec < Math.max(minPrec, 1)) break
      next()
      left = { k:'binary', op, l:left, r:parseExpr(RIGHT_ASSOC.has(op) ? prec : prec + 1) }
    }
    if (minPrec <= 0 && peek().t === 'op' && peek().v === '?') {
      next()
      const a = parseExpr(0)
      expectOp(':')
      const b = parseExpr(0)
      left = { k:'cond', c:left, a, b }
    }
    return left
  }
  function parseExpr(minPrec = 0) {
    if (++depth > PARSE_MAX_DEPTH) throw new FormulaError('Formula nesting too deep', peek().pos)
    try { return parseExprInner(minPrec) } finally { depth-- }
  }
  const ast = parseExpr(0)
  const end = peek()
  if (end.t !== 'eof') throw new FormulaError(`Unexpected "${end.v ?? ''}"`, end.pos)
  return ast
}

// ---- Interpreter
const LAMBDA_FNS = new Set(['filter','map','some','every','find','findIndex'])

// local coercions — formula-functions.js keeps its own private; these mirror them but preserve null
const toDateV = (v) => (dayjs.isDayjs(v) ? v : v && typeof v === 'object' && v.__date ? dayjs(v.ms) : null)
const toNumV = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v == null) return null
  if (dayjs.isDayjs(v)) return v.valueOf()
  if (Array.isArray(v)) return toNumV(v[0])
  if (typeof v === 'object') return toNumV(unstyled(v))
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
const toStrV = (v) => {
  if (v == null) return ''
  if (typeof v === 'boolean') return String(v)
  if (dayjs.isDayjs(v)) return v.toISOString()
  if (Array.isArray(v)) return v.map(toStrV).join(', ')
  if (typeof v === 'object') {
    if (v.__date) return new Date(v.ms).toISOString()
    const u = unstyled(v)
    if (u !== v) return toStrV(u)
    return String(v.text ?? '')
  }
  return String(v)
}
const normV = (v) => {
  if (dayjs.isDayjs(v)) return v.valueOf()
  if (v && typeof v === 'object') {
    if (v.__styled) return normV(v.text)
    if (v.__date) return v.ms
    if (Array.isArray(v)) return v.map(normV)
  }
  return v
}
const eqV = (l, r) => {
  const a = normV(l), b = normV(r)
  if (a == null || b == null) return a == b
  if (a === b) return true
  if (typeof a === 'object' && typeof b === 'object') { try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false } }
  return String(a) === String(b)
}
const truthy = (v) => !(v == null || v === false || v === 0 || v === '')

export function evaluate(ast, ctx = {}) {
  let steps = 0
  const env = { ...ctx, vars:{}, depth:0 }
  const bump = () => { if (++steps > MAX_STEPS) throw new FormulaError('Formula too complex') }
  // {__date} tags are a serialization convention; inside evaluation dates are dayjs objects
  const unwrapCell = (v) => (v && typeof v === 'object' && v.__date ? dayjs(v.ms) : v)

  const resolveProp = (name) => {
    const p = ctx.props
    if (p instanceof Map) {
      if (p.has(name)) return p.get(name)
      const lower = String(name).toLowerCase()
      for (const [k, v] of p) if (String(k).toLowerCase() === lower) return v
      return null
    }
    if (p && Object.prototype.hasOwnProperty.call(p, name)) return p[name]
    const key = p ? Object.keys(p).find((k) => k.toLowerCase() === String(name).toLowerCase()) : undefined
    return key !== undefined ? p[key] : null
  }
  const lookupProp = (name) => {
    const v = resolveProp(name)
    return v === undefined ? null : unwrapCell(v)
  }

  function numOrConcat(op, l, r) {
    if (op === '+') {
      const ul = unstyled(l), ur = unstyled(r)
      if (typeof ul === 'string' || typeof ur === 'string' || Array.isArray(ul) || Array.isArray(ur)) return toStrV(ul) + toStrV(ur)
    }
    const a = toNumV(l), b = toNumV(r)
    if (a == null || b == null) return null
    if (op === '+') return a + b
    if (op === '-') return a - b
    if (op === '*') return a * b
    if (op === '/') return b ? a / b : null
    if (op === '%') return b ? a % b : null
    return Math.pow(a, b)
  }

  function compare(op, l, r) {
    if (op === '==') return eqV(l, r)
    if (op === '!=') return !eqV(l, r)
    const dl = toDateV(l), dr = toDateV(r)
    let a, b
    if (dl && dr) { a = dl.valueOf(); b = dr.valueOf() }
    else if (typeof l === 'string' && typeof r === 'string') { a = l.toLowerCase(); b = r.toLowerCase() }
    else { a = toNumV(l); b = toNumV(r) }
    if (a == null || b == null) return null
    if (op === '<') return a < b
    if (op === '>') return a > b
    if (op === '<=') return a <= b
    return a >= b
  }

  function evalLambdaFn(name, args, env) {
    const list = evalNode(args[0], env)
    const lam = args[1]
    if (!Array.isArray(list)) throw new FormulaError(`${name}() expects a list`)
    const inner = (item, idx) => ({ ...env, current:item, index:idx })
    if (name === 'map') return list.map((item, idx) => evalNode(lam, inner(item, idx)))
    if (name === 'filter') return list.filter((item, idx) => truthy(evalNode(lam, inner(item, idx))))
    if (name === 'some') return list.some((item, idx) => truthy(evalNode(lam, inner(item, idx))))
    if (name === 'every') return list.every((item, idx) => truthy(evalNode(lam, inner(item, idx))))
    if (name === 'find') { const hit = list.find((item, idx) => truthy(evalNode(lam, inner(item, idx)))); return hit ?? null }
    return list.findIndex((item, idx) => truthy(evalNode(lam, inner(item, idx)))) // findIndex
  }

  const maybe = (node, e) => (node ? evalNode(node, e) : null)

  function callFn(name, args, env) {
    switch (name) {
      case 'prop': {
        if (!args.length) throw new FormulaError('prop() requires a column name')
        return lookupProp(toStrV(evalNode(args[0], env)))
      }
      case 'if':
        return truthy(evalNode(args[0], env)) ? maybe(args[1], env) : maybe(args[2], env)
      case 'ifs': {
        for (let i = 0; i + 1 < args.length; i += 2) if (truthy(evalNode(args[i], env))) return evalNode(args[i + 1], env)
        return args.length % 2 ? evalNode(args[args.length - 1], env) : null
      }
      case 'and': { for (const a of args) if (!truthy(evalNode(a, env))) return false; return true }
      case 'or': { for (const a of args) if (truthy(evalNode(a, env))) return true; return false }
      case 'let': {
        if (args.length < 3) throw new FormulaError('let() takes (name, value, expression)')
        const bound = toStrV(evalNode(args[0], env))
        const val = evalNode(args[1], env)
        return evalNode(args[2], { ...env, vars:{ ...env.vars, [bound]: val } })
      }
      case 'lets': {
        if (args.length < 3) throw new FormulaError('lets() takes pairs of (name, value) plus an expression')
        const vars = { ...env.vars }
        for (let i = 0; i + 2 < args.length; i += 2) {
          const bound = toStrV(evalNode(args[i], env))
          vars[bound] = evalNode(args[i + 1], { ...env, vars })
        }
        return evalNode(args[args.length - 1], { ...env, vars })
      }
      default:
        if (LAMBDA_FNS.has(name)) return evalLambdaFn(name, args, env)
    }
    const f = FUNCS[name]
    if (!f) throw new FormulaError(`Unknown function "${name}"`)
    return f.fn(ctx, ...args.map((a) => evalNode(a, env)))
  }

  function evalNode(node, env) {
    bump()
    if (++env.depth >= MAX_DEPTH) throw new FormulaError('Formula nesting too deep')
    try {
      switch (node.k) {
        case 'lit': return node.v
        case 'current': return env.current ?? null
        case 'index': return env.index ?? 0
        case 'list': return node.items.map((it) => evalNode(it, env))
        case 'var': return Object.prototype.hasOwnProperty.call(env.vars, node.name) ? env.vars[node.name] : null
        case 'prop': return lookupProp(node.name)
        case 'call': return callFn(node.name, node.args, env)
        case 'cond': return truthy(evalNode(node.c, env)) ? evalNode(node.a, env) : evalNode(node.b, env)
        case 'unary': {
          const v = evalNode(node.arg, env)
          if (node.op !== '-') return !truthy(v)
          const n = toNumV(v)
          return n == null ? null : -n
        }
        case 'binary': {
          const op = node.op
          if (op === '&&' || op === 'and') return truthy(evalNode(node.l, env)) ? truthy(evalNode(node.r, env)) : false
          if (op === '||' || op === 'or') return truthy(evalNode(node.l, env)) ? true : truthy(evalNode(node.r, env))
          const l = evalNode(node.l, env)
          const r = evalNode(node.r, env)
          if (COMPARISONS.has(op)) return compare(op, l, r)
          return numOrConcat(op, l, r)
        }
        default: throw new FormulaError('Malformed expression')
      }
    } finally { env.depth-- }
  }

  return evalNode(ast, env)
}

export function evaluateExpression(src, ctx = {}) {
  return evaluate(parse(src), ctx)
}

export function extractRefs(input) {
  const ast = typeof input === 'string' ? parse(input) : input
  const refs = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.k === 'call' && node.name === 'prop' && node.args?.length === 1 && node.args[0].k === 'lit' && typeof node.args[0].v === 'string') refs.add(node.args[0].v)
    for (const key of ['args','items']) if (Array.isArray(node[key])) node[key].forEach(walk)
    for (const key of ['l','r','arg','c','a','b']) if (node[key]) walk(node[key])
  }
  walk(ast)
  return refs
}

// Dates crossing serialization boundaries are tagged objects: { __date:true, ms:number },
// produced by storage layers when column.type === 'date'; lookupProp returns cell values as-is.
