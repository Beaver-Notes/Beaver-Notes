import { describe, it, expect } from 'vitest'
import { richTextToPlain, plainToRichText, richTextPreview } from '../rich-text-convert'

describe('rich-text-convert', () => {
  it('converts both directions', () => {
    expect(richTextToPlain([{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }])).toBe('Hello world')
    expect(plainToRichText('Hi')).toEqual([{ type: 'text', text: 'Hi' }])
    expect(plainToRichText('')).toEqual([])
    expect(richTextToPlain(null)).toBe('')
  })
  it('previews at 400 chars', () => {
    expect(richTextPreview(plainToRichText('x'.repeat(500)))).toHaveLength(400)
  })
})
