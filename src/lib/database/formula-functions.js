// src/lib/database/formula-functions.js
import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear'
import { formatNumber } from './number-format'

dayjs.extend(weekOfYear)

export const NATIVE_LAZY = ['if','ifs','let','lets','and','or','filter','map','some','every','find','findIndex']
export const style = (text, color = 'default') => ({ __styled:true, text:String(text ?? ''), color })
export const unstyled = (v) => v && typeof v === 'object' && v.__styled ? unstyled(v.text) : Array.isArray(v) ? v.map(unstyled) : v

const toDate = (v) => (dayjs.isDayjs(v) ? v : v ? dayjs(v) : null)
const toNum = (v) => {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v == null) return 0
  if (dayjs.isDayjs(v)) return v.valueOf()
  if (Array.isArray(v)) return toNum(v[0])
  if (typeof v === 'object') return toNum(unstyled(v.text))
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}
const toStr = (v) => {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (dayjs.isDayjs(v)) return v.toISOString()
  if (Array.isArray(v)) return v.map(toStr).join(', ')
  if (typeof v === 'object') return String(unstyled(v.text ?? ''))
  return String(v)
}
const flat = (args) => args.flatMap((a) => (Array.isArray(a) ? a : [a]))
const nums = (args) => flat(args).map(toNum)
const regexOf = (p) => (p instanceof RegExp ? p : new RegExp(String(p)))
const UNIT_ALIAS = { second:'s',seconds:'s', minute:'m',minutes:'m', hour:'h',hours:'h', day:'d',days:'d', week:'w',weeks:'w', month:'M',months:'M', quarter:'Q',quarters:'Q', year:'y',years:'y' }

export const FUNCS = {
  // logic
  empty:   { args:['any'], returns:'boolean', fn:(c,v)=>v==null||v===''||(Array.isArray(v)&&!v.length)||v===false },
  equal:   { args:['any','any'], returns:'boolean', fn:(c,a,b)=>eqVal(a,b) },
  unequal: { args:['any','any'], returns:'boolean', fn:(c,a,b)=>!eqVal(a,b) },
  // text
  length:   { args:['any'], returns:'number', fn:(c,v)=>Array.isArray(v)?v.length:toStr(v).length },
  substring:{ args:['string','number','number'], returns:'string', fn:(c,s,a,b)=>toStr(s).slice(a,b??undefined) },
  contains: { args:['any','any'], returns:'boolean', fn:(c,h,n)=>Array.isArray(h)?h.some(x=>eqVal(x,n)):toStr(h).toLowerCase().includes(toStr(n).toLowerCase()) },
  test:     { args:['string','any'], returns:'boolean', fn:(c,s,p)=>regexOf(p).test(toStr(s)) },
  match:    { args:['string','any'], returns:'list', fn:(c,s,p)=>toStr(s).match(regexOf(p)) ?? [] },
  replace:     { args:['string','any','string'], returns:'string', fn:(c,s,p,r)=>toStr(s).replace(regexOf(p),r) },
  replaceAll:  { args:['string','any','string'], returns:'string', fn:(c,s,p,r)=>toStr(s).replaceAll(regexOf(p),r) },
  lower:{ args:['string'], returns:'string', fn:(c,s)=>toStr(s).toLowerCase() },
  upper:{ args:['string'], returns:'string', fn:(c,s)=>toStr(s).toUpperCase() },
  repeat:{ args:['string','number'], returns:'string', fn:(c,s,n)=>toStr(s).repeat(Math.max(0,toNum(n))) },
  link: { args:['string','string'], returns:'any', fn:(c,label,url)=>({ __link:true, label:toStr(label), url:toStr(url) }) },
  style:{ args:['any','string'], returns:'any', fn:(c,t,col)=>style(t, col) },
  unstyle:{ args:['any'], returns:'any', fn:(c,v)=>unstyled(v) },
  format:{ args:['any'], returns:'string', fn:(c,v)=>toStr(v) },
  trim: { args:['string'], returns:'string', fn:(c,s)=>toStr(s).trim() },
  // math
  add:      { args:['number','number'], returns:'number', fn:(c,a,b)=>toNum(a)+toNum(b) },
  subtract: { args:['number','number'], returns:'number', fn:(c,a,b)=>toNum(a)-toNum(b) },
  multiply: { args:['number','number'], returns:'number', fn:(c,a,b)=>toNum(a)*toNum(b) },
  divide:   { args:['number','number'], returns:'number', fn:(c,a,b)=>b?toNum(a)/toNum(b):null },
  mod:      { args:['number','number'], returns:'number', fn:(c,a,b)=>toNum(a)%toNum(b) },
  pow:      { args:['number','number'], returns:'number', fn:(c,a,b)=>Math.pow(toNum(a),toNum(b)) },
  min:      { args:['list'], returns:'number', fn:(_c,...xs)=>Math.min(...nums(xs)) },
  max:      { args:['list'], returns:'number', fn:(_c,...xs)=>Math.max(...nums(xs)) },
  sum:      { args:['list'], returns:'number', fn:(_c,...xs)=>nums(xs).reduce((s,n)=>s+n,0) },
  median:   { args:['list'], returns:'number', fn:(_c,...xs)=>{ const s=nums(xs).sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2 } },
  mean:     { args:['list'], returns:'number', fn:(_c,...xs)=>{ const a=nums(xs); return a.length?a.reduce((s,n)=>s+n,0)/a.length:0 } },
  abs:   { args:['number'], returns:'number', fn:(c,n)=>Math.abs(toNum(n)) },
  round: { args:['number'], returns:'number', fn:(c,n)=>Math.round(toNum(n)) },
  ceil:  { args:['number'], returns:'number', fn:(c,n)=>Math.ceil(toNum(n)) },
  floor: { args:['number'], returns:'number', fn:(c,n)=>Math.floor(toNum(n)) },
  sqrt:  { args:['number'], returns:'number', fn:(c,n)=>Math.sqrt(Math.max(0,toNum(n))) },
  cbrt:  { args:['number'], returns:'number', fn:(c,n)=>Math.cbrt(toNum(n)) },
  exp:   { args:['number'], returns:'number', fn:(c,n)=>Math.exp(toNum(n)) },
  ln:    { args:['number'], returns:'number', fn:(c,n)=>Math.log(Math.max(1e-300,toNum(n))) },
  log10: { args:['number'], returns:'number', fn:(c,n)=>Math.log10(Math.max(1e-300,toNum(n))) },
  log2:  { args:['number'], returns:'number', fn:(c,n)=>Math.log2(Math.max(1e-300,toNum(n))) },
  sign:  { args:['number'], returns:'number', fn:(c,n)=>Math.sign(toNum(n)) },
  toNumber:{ args:['any'], returns:'number', fn:(c,v)=>toNum(v) },
  // date/time
  now:   { args:[], returns:'date', fn:(c)=>c.now ? c.now() : dayjs() },
  today: { args:[], returns:'date', fn:(c)=>c.now ? c.now().startOf('day') : dayjs().startOf('day') },
  parseDate: { args:['string'], returns:'date', fn:(c,s)=>toDate(s) },
  formatDate: { args:['date','string'], returns:'string', fn:(c,d,f)=>toDate(d)?.format(f) ?? '' },
  formatNumber: { args:['number','string'], returns:'string', fn:(c,n,f)=>formatNumber(toNum(n), f) },
  dateAdd:      { args:['date','number','string'], returns:'date', fn:(c,d,n,u)=>toDate(d)?.add(toNum(n),UNIT_ALIAS[u]??'d') ?? null },
  dateSubtract: { args:['date','number','string'], returns:'date', fn:(c,d,n,u)=>toDate(d)?.subtract(toNum(n),UNIT_ALIAS[u]??'d') ?? null },
  dateBetween:  { args:['date','date','string'], returns:'number', fn:(c,a,b,u)=>toDate(b)?toDate(a).diff(toDate(b),UNIT_ALIAS[u]??'d'):null },
  dateRange: { args:['date','date'], returns:'any', fn:(c,a,b)=>({ start:toDate(a)?.toISOString()??null, end:toDate(b)?.toISOString()??null }) },
  dateStart: { args:['any'], returns:'date', fn:(c,v)=>toDate(v?.start ?? v) },
  dateEnd:   { args:['any'], returns:'date', fn:(c,v)=>toDate(v?.end ?? v) },
  timestamp:    { args:['date'], returns:'number', fn:(c,d)=>toDate(d)?.valueOf() ?? null },
  fromTimestamp:{ args:['number'], returns:'date', fn:(c,n)=>dayjs(toNum(n)) },
  minute: { args:['date'], returns:'number', fn:(c,d)=>toDate(d)?.minute() ?? null },
  hour:   { args:['date'], returns:'number', fn:(c,d)=>toDate(d)?.hour() ?? null },
  day:    { args:['date'], returns:'number', fn:(c,d)=>toDate(d)?.day() ?? null },
  week:   { args:['date'], returns:'number', fn:(c,d)=>toDate(d)?.week() ?? null },
  month:  { args:['date'], returns:'number', fn:(c,d)=>toDate(d)?.month() ?? null },
  year:   { args:['date'], returns:'number', fn:(c,d)=>toDate(d)?.year() ?? null },
  // list (lazy lambda fns live in evaluator)
  at:      { args:['list','number'], returns:'any', fn:(c,l,i)=>l?.[toNum(i)] ?? null },
  first:   { args:['list'], returns:'any', fn:(c,l)=>l?.[0] ?? null },
  last:    { args:['list'], returns:'any', fn:(c,l)=>l?.[l.length-1] ?? null },
  slice:   { args:['list','number','number'], returns:'list', fn:(c,l,a,b)=>(l??[]).slice(a,b??undefined) },
  concat:  { args:['list'], returns:'list', fn:(_c,...ls)=>flat(ls.map(x=>Array.isArray(x)?x:[x])) },
  sort:    { args:['list'], returns:'list', fn:(c,l)=>[...(l??[])].sort((a,b)=>cmpSort(a,b)) },
  reverse: { args:['list'], returns:'list', fn:(c,l)=>[...(l??[])].reverse() },
  join:    { args:['list','string'], returns:'string', fn:(c,l,sep)=>(l??[]).map(toStr).join(sep??', ') },
  split:   { args:['string','string'], returns:'list', fn:(c,s,sep)=>toStr(s).split(sep??' ') },
  // ponytail: O(n²) eqVal scan; switch to Set/hash when lists get big
  unique:  { args:['list'], returns:'list', fn:(c,l)=>(l??[]).filter((x,i)=>!(l??[]).slice(0,i).some(y=>eqVal(x,y))) },
  includes:{ args:['list','any'], returns:'boolean', fn:(c,l,v)=>(l??[]).some(x=>eqVal(x,v)) },
  // person
  name:  { args:['any'], returns:'string', fn:(c,p)=>personField(c,p,'name') },
  email: { args:['any'], returns:'string', fn:(c,p)=>personField(c,p,'email') },
}

function eqVal(a, b) {
  const ua = unstyled(a), ub = unstyled(b)
  if (dayjs.isDayjs(ua) && dayjs.isDayjs(ub)) return ua.valueOf() === ub.valueOf()
  if (ua === ub) return true
  if (ua == null || ub == null) return ua == ub
  if (typeof ua === 'object' && typeof ub === 'object') try { return JSON.stringify(ua) === JSON.stringify(ub) } catch { return false }
  return String(ua) === String(ub)
}
function cmpSort(a, b) {
  const na = toNum(a), nb = toNum(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'string' && typeof b !== 'string') return na - nb
  return toStr(a).localeCompare(toStr(b))
}
// ponytail: person id resolution only hits ctx.users (Map); no user index/cache unless lookups get hot
function personField(ctx, p, field) {
  if (Array.isArray(p)) p = p[0]
  if (p && typeof p === 'object') return String(p[field] ?? '')
  const u = p != null && ctx?.users?.get ? ctx.users.get(p) : undefined
  return u ? String(u[field] ?? '') : ''
}

export const SIGNATURES = Object.fromEntries([
  ...Object.entries(FUNCS).map(([n, f]) => [n, { args:f.args, returns:f.returns }]),
  ...Object.entries({
    if:['boolean','any','any'], ifs:['any'], let:['any'], lets:['any'],
    and:['any'], or:['any'], filter:['list'], map:['list'], some:['list'], every:['list'], find:['list'], findIndex:['list'],
  }).map(([n, a]) => [n, { args:a, returns:n.startsWith('find')?'any':n==='map'||n==='filter'?'list':'any' }]),
])
