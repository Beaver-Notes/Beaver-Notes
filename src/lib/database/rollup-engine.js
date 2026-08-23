function isEmptyValue(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
}

const present = (values) => values.filter((v) => !isEmptyValue(v))

function numericValues(values) {
  const out = []
  for (const v of present(values)) {
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function dateKey(v) {
  const s = v != null && typeof v === 'object' && 'start' in v ? v.start : v
  if (s == null || s === '') return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : { t, s }
}

function datedValues(values) {
  const out = []
  for (const v of present(values)) {
    const d = dateKey(v)
    if (d) out.push(d)
  }
  return out
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function percent(part, total) {
  return total ? Math.round((part / total) * 100) : null
}

const FNS = {
  count_all: (vs) => vs.length,
  count_values: (vs) => present(vs).length,
  count_unique_values: (vs) => new Set(present(vs).map((v) => JSON.stringify(v))).size,
  count_empty: (vs) => vs.filter(isEmptyValue).length,
  count_not_empty: (vs) => present(vs).length,
  percent_empty: (vs) => percent(vs.filter(isEmptyValue).length, vs.length),
  percent_not_empty: (vs) => percent(present(vs).length, vs.length),
  sum: (vs) => {
    const nums = numericValues(vs)
    return nums.length ? nums.reduce((a, n) => a + n, 0) : null
  },
  average: (vs) => {
    const nums = numericValues(vs)
    return nums.length ? nums.reduce((a, n) => a + n, 0) / nums.length : null
  },
  median: (vs) => {
    const nums = numericValues(vs)
    return nums.length ? median(nums) : null
  },
  min: (vs) => {
    const nums = numericValues(vs)
    return nums.length ? Math.min(...nums) : null
  },
  max: (vs) => {
    const nums = numericValues(vs)
    return nums.length ? Math.max(...nums) : null
  },
  range: (vs) => {
    const nums = numericValues(vs)
    return nums.length ? Math.max(...nums) - Math.min(...nums) : null
  },
  show_original: (vs) => vs,
  earliest_date: (vs) => {
    const ds = datedValues(vs)
    return ds.length ? ds.reduce((a, b) => (b.t < a.t ? b : a)).s : null
  },
  latest_date: (vs) => {
    const ds = datedValues(vs)
    return ds.length ? ds.reduce((a, b) => (b.t > a.t ? b : a)).s : null
  },
  date_range: (vs) => {
    const e = FNS.earliest_date(vs)
    return e == null ? null : `${e} → ${FNS.latest_date(vs)}`
  },
  checked: (vs) => vs.filter((v) => v === true).length,
  unchecked: (vs) => vs.filter((v) => !v).length,
  percent_checked: (vs) => percent(FNS.checked(vs), vs.length),
  percent_unchecked: (vs) => percent(FNS.unchecked(vs), vs.length),
  count_per_group: (vs) => {
    const groups = {}
    for (const v of present(vs)) groups[v] = (groups[v] || 0) + 1
    return groups
  },
}

export function computeRollup(values, config) {
  const fn = FNS[config?.function]
  return fn ? fn(values ?? []) : null
}
