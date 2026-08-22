export function richTextToPlain(nodes = []) {
  if (!Array.isArray(nodes)) return nodes ?? ''
  return nodes.map((n) => n?.text ?? '').join('')
}
export function plainToRichText(text = '') {
  return text ? [{ type: 'text', text }] : []
}
export function richTextPreview(nodes = [], len = 400) {
  return richTextToPlain(nodes).slice(0, len)
}
