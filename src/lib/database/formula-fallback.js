// Rule-based describe→formula fallback. No model, no worker (Delta 1 cut).
// Ordered [regex, builder] table; builders emit expressions using only
// catalog functions from formula-functions.js.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function colPattern(columns) {
  const names = columns.map((c) => c.name).filter(Boolean).sort((a, b) => b.length - a.length)
  return names.length ? new RegExp(`(?:${names.map(esc).join('|')})`, 'i') : null
}

const rules = [
  // "days until <date col>" / "days since <date col>"
  {
    re: /\bdays\s+(until|till|since)\b/i,
    build(text, columns) {
      const pat = colPattern(columns)
      if (!pat) return null
      const dateCols = columns.filter((c) => c.type === 'date')
      if (!dateCols.length) return null
      const m = text.match(new RegExp(`\\bdays\\s+(until|till|since)\\s+(${pat.source})\\b`, 'i'))
      if (!m) return null
      const col = columns.find((c) => c.name.toLowerCase() === m[2].toLowerCase())
      if (!col || col.type !== 'date') return null
      const since = /since/i.test(m[1])
      const args = since
        ? ['now()', `prop(${JSON.stringify(col.name)})`]
        : [`prop(${JSON.stringify(col.name)})`, 'now()']
      return `dateBetween(${args.join(', ')}, "days")`
    },
  },
  // overdue highlighting → red style when date col is before today
  {
    re: /\boverdue\b/i,
    build(_text, columns) {
      const col = columns.find((c) => c.type === 'date')
      if (!col) return null
      return `if(dateBefore(prop(${JSON.stringify(col.name)}), today()), style("Overdue", "red"), "")`
    },
  },
  // "<verb> <select col> where X is n and Y is m"
  {
    re: /\bwhere\b\s+\S+\s+\bis\b/i,
    build(text, columns) {
      const pat = colPattern(columns.filter((c) => c.type === 'select'))
      if (!pat) return null
      const head = text.match(new RegExp(`\\b(${pat.source})\\b[\\s\\S]*\\bwhere\\b`, 'i'))
      if (!head) return null
      const col = columns.find((c) => c.name.toLowerCase() === head[1].toLowerCase())
      if (!col) return null
      const optNames = (col.config?.options ?? []).map((o) => o.name).sort((a, b) => b.length - a.length)
      if (!optNames.length) return null
      const pairs = []
      const optPat = optNames.map(esc).join('|')
      const pairRe = new RegExp(`(${optPat})\\s+is\\s+(-?\\d+(?:\\.\\d+)?)`, 'gi')
      let p
      while ((p = pairRe.exec(text))) pairs.push([optNames.find((n) => n.toLowerCase() === p[1].toLowerCase()), p[2]])
      if (!pairs.length) return null
      let expr = 'null'
      for (const [name, num] of [...pairs].reverse()) {
        expr = `if(prop(${JSON.stringify(col.name)}) == ${JSON.stringify(name)}, ${num}, ${expr})`
      }
      return expr
    },
  },
  // "% of <checkbox col> checked" / "percent complete"
  {
    re: /\bpercent(?:age)?\b|%/i,
    build(text, columns) {
      const chk = columns.filter((c) => c.type === 'checkbox')
      if (!chk.length) return null
      const pat = new RegExp(chk.map((c) => esc(c.name)).sort((a, b) => b.length - a.length).join('|'), 'i')
      const m = text.match(pat)
      if (!m) return null
      const col = chk.find((c) => c.name.toLowerCase() === m[0].toLowerCase())
      return `format(round(prop(${JSON.stringify(col.name)}) * 100)) + "%"`
    },
  },
  // "combine/join/concatenate <text col> and <text col>"
  {
    re: /\b(combine|join|concatenate|merge)\b/i,
    build(text, columns) {
      const txt = columns.filter((c) => c.type === 'rich_text' || c.type === 'text')
      if (txt.length < 2) return null
      const pat = new RegExp(txt.map((c) => esc(c.name)).sort((a, b) => b.length - a.length).join('|'), 'i')
      const found = []
      let rest = text
      while (found.length < 2) {
        const m = rest.match(pat)
        if (!m) break
        const name = txt.find((c) => c.name.toLowerCase() === m[0].toLowerCase()).name
        if (!found.includes(name)) found.push(name)
        rest = rest.slice(m.index + m[0].length)
      }
      if (found.length !== 2) return null
      return `concat(prop(${JSON.stringify(found[0])}), " ", prop(${JSON.stringify(found[1])}))`
    },
  },
]

export function generateFromDescription(text, columns) {
  if (!text || !Array.isArray(columns)) return { error: 'could-not-generate' }
  for (const rule of rules) {
    if (!rule.re.test(text)) continue
    try {
      const formula = rule.build(text, columns)
      if (formula) return { formula }
    } catch {
      /* try next rule */
    }
  }
  return { error: 'could-not-generate' }
}
