// Pure decision logic for lazy note-backed rows (Delta 3).
// A row stays a lightweight record until first opened; opening materializes an
// ORDINARY note via the existing note store (searchable, backed up, not
// `db:`-prefixed). The row stores the note id on the Y.Map next to `cells`
// (cells are column-keyed), so it never collides with column ids.
import { richTextToPlain } from './rich-text-convert'

export function backingNoteIdOf(row) {
  return row?.noteId ?? null
}

export function rowTitleText(schema, row) {
  const col = schema?.columns?.find((c) => c.type === 'title')
  return String(richTextToPlain(col ? row?.cells?.[col.id] : null) ?? '')
}

// Reuse the materialized id when present, otherwise create via callback.
// The caller persists the returned id onto the row (setRowNoteId), so second
// call takes the reuse branch.
export async function ensureBackingNote({ row, title, createNote }) {
  const existing = backingNoteIdOf(row)
  if (existing) return existing
  const created = await createNote(title)
  return typeof created === 'string' ? created : (created?.id ?? null)
}
