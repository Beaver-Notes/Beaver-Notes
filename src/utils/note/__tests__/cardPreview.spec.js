import { describe, it, expect } from 'vitest'
import { buildCardPreview, setCardPreviewLabels } from '@/utils/note/cardPreview.js'

describe('cardPreview structural', () => {
  it('unwraps columnContainer/column', () => {
    const content = { type:'doc', content:[
      { type:'columnContainer', content:[
        { type:'column', content:[{ type:'paragraph', content:[{type:'text', text:'inside column'}]}]},
        { type:'column', content:[{ type:'heading', attrs:{level:2}, content:[{type:'text', text:'col heading'}]}]},
      ]}
    ]}
    const p = buildCardPreview(content)
    expect(p.blocks.map(b=>b.text)).toContain('inside column')
    expect(p.blocks.map(b=>b.text)).toContain('col heading')
  })
  it('renders horizontalRule as separator', () => {
    const content = { type:'doc', content:[
      {type:'paragraph', content:[{type:'text', text:'a'}]},
      {type:'horizontalRule'},
      {type:'paragraph', content:[{type:'text', text:'b'}]},
    ]}
    const p = buildCardPreview(content)
    expect(p.blocks.length).toBe(3)
    expect(p.blocks[1].text).toBe('—')
  })
  it('MEDIA_TYPES labels respect setCardPreviewLabels', () => {
    setCardPreviewLabels({ diagram:'Diagramme' })
    const content = { type:'doc', content:[{type:'mermaidBlock', attrs:{}}]}
    const p = buildCardPreview(content)
    expect(p.blocks[0].label).toBe('Diagramme')
    setCardPreviewLabels({}) // reset
  })
  it('caps at 5/240', () => {
    // 100-char paragraphs truncate to 96 but hit 240-char budget after ~3 blocks
    // so total caps before block count — assert both limits hold
    const content = { type:'doc', content: Array(10).fill(0).map(()=>({type:'paragraph', content:[{type:'text', text:'x'.repeat(100)}]}))}
    const p = buildCardPreview(content)
    expect(p.blocks.length).toBeLessThanOrEqual(5)
    const total = p.blocks.reduce((s,b)=> s + (b.text? b.text.length:0), 0)
    expect(total).toBeLessThanOrEqual(240)
    expect(p.hasMore).toBe(true)
    // with short paras, block count caps at 5
    const short = { type:'doc', content: Array(10).fill(0).map(()=>({type:'paragraph', content:[{type:'text', text:'hi'}]}))}
    const p2 = buildCardPreview(short)
    expect(p2.blocks.length).toBe(5)
    expect(p2.hasMore).toBe(true)
  })
  it('hardBreak becomes space', () => {
    const content = { type:'doc', content:[{type:'paragraph', content:[{type:'text', text:'a'}, {type:'hardBreak'}, {type:'text', text:'b'}]}]}
    const p = buildCardPreview(content)
    expect(p.blocks[0].text).toBe('a b')
  })
})
