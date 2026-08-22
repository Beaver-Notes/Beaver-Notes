export const NUMBER_FORMATS = ['plain','comma','percent','dollar','euro','pound','yen','yuan','rupee','won','ruble','zloty','shekel','koruna','baht','forint','franc','krona']

const CURRENCY_CODES = { dollar:'USD', euro:'EUR', pound:'GBP', yen:'JPY', yuan:'CNY', rupee:'INR', won:'KRW', ruble:'RUB', zloty:'PLN', shekel:'ILS', koruna:'CZK', baht:'THB', forint:'HUF', franc:'CHF', krona:'SEK' }

export function formatNumber(value, format = 'plain') {
  if (value == null || value === '' || Number.isNaN(Number(value))) return ''
  const n = Number(value)
  if (format === 'percent') return new Intl.NumberFormat(undefined, { style: 'percent' }).format(n)
  const currency = CURRENCY_CODES[format]
  return new Intl.NumberFormat(undefined, currency ? { style: 'currency', currency } : { useGrouping: format === 'comma' }).format(n)
}

export function parseNumberInput(str) {
  if (typeof str !== 'string') return str == null ? null : (Number.isFinite(Number(str)) ? Number(str) : null)
  const cleaned = str.replace(/[^0-9.eE+-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
