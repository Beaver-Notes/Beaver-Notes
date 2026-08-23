import { describe, it, expect, vi } from 'vitest'
import { backingNoteIdOf, rowTitleText, ensureBackingNote } from '../row-notes'

const schema = {
  columns: [
    { id: 't', name: 'Name', type: 'title' },
    { id: 'n', name: 'Points', type: 'number' },
  ],
}

describe('backingNoteIdOf', () => {
  it('returns null for missing rows and rows never opened', () => {
    expect(backingNoteIdOf(null)).toBe(null)
    expect(backingNoteIdOf({ id: 'r1', cells: {} })).toBe(null)
  })

  it('reads the noteId stored next to cells on the row', () => {
    expect(backingNoteIdOf({ id: 'r1', cells: {}, noteId: 'note1' })).toBe('note1')
  })
})

describe('rowTitleText', () => {
  it('flattens the title cell rich text to plain text', () => {
    const row = {
      cells: { t: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'World' }] },
    }
    expect(rowTitleText(schema, row)).toBe('Hello World')
  })

  it('is empty when the row or title column is missing', () => {
    expect(rowTitleText({ columns: [] }, { cells: {} })).toBe('')
    expect(rowTitleText(schema, null)).toBe('')
  })
})

describe('ensureBackingNote', () => {
  it('reuses an already-materialized note without creating one', async () => {
    const createNote = vi.fn()
    await expect(
      ensureBackingNote({ row: { id: 'r1', cells: {}, noteId: 'note1' }, createNote })
    ).resolves.toBe('note1')
    expect(createNote).not.toHaveBeenCalled()
  })

  it('creates the ordinary note once via callback and reuses it on second call', async () => {
    const createNote = vi.fn(async (title) => ({ id: `note-${title}` }))
    const first = await ensureBackingNote({
      row: { id: 'r1', cells: {} },
      title: 'Ada',
      createNote,
    })
    expect(first).toBe('note-Ada')
    expect(createNote).toHaveBeenCalledTimes(1)
    expect(createNote).toHaveBeenCalledWith('Ada')

    // Second open happens after the caller persisted noteId onto the row.
    const second = await ensureBackingNote({
      row: { id: 'r1', cells: {}, noteId: first },
      title: 'Ada',
      createNote,
    })
    expect(second).toBe('note-Ada')
    expect(createNote).toHaveBeenCalledTimes(1)
  })
})
