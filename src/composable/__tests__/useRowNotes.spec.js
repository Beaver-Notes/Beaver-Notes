import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRowNotes } from '@/composable/useRowNotes';

const h = vi.hoisted(() => ({
  routerPush: vi.fn(),
  store: { add: vi.fn(), getById: vi.fn(), delete: vi.fn() },
}));

vi.mock('vue-router', () => ({ useRouter: () => ({ push: h.routerPush }) }));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('@/store/note', () => ({ useNoteStore: () => h.store }));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { value: { database: {} } } }),
}));

const schema = { columns: [{ id: 't', name: 'Name', type: 'title' }] };

function setupDb() {
  return {
    version: { value: 0 },
    getRow: vi.fn(() => null),
    setRowNoteId: vi.fn(),
    deleteRow: vi.fn(),
    updateCells: vi.fn(),
  };
}

describe('openRowPage materialization', () => {
  let db;
  let c;

  beforeEach(() => {
    vi.clearAllMocks();
    db = setupDb();
    c = useRowNotes(schema, db);
  });

  it('does not create a second note when a second open races the first', async () => {
    let resolveAdd;
    h.store.add.mockImplementation(
      () => new Promise((resolve) => (resolveAdd = resolve)),
    );
    h.store.getById.mockReturnValue(undefined);
    db.getRow.mockReturnValue({ id: 'r1', cells: {}, noteId: null });

    const first = c.openRowPage('r1');
    const second = c.openRowPage('r1');
    resolveAdd({ id: 'note-1' });
    await Promise.all([first, second]);

    expect(h.store.add).toHaveBeenCalledTimes(1);
    expect(db.setRowNoteId).toHaveBeenCalledWith('r1', 'note-1');
    expect(h.routerPush).toHaveBeenCalledTimes(1);
    expect(h.routerPush).toHaveBeenCalledWith('/note/note-1');
  });

  it('clears a stale noteId and materializes a fresh note instead', async () => {
    let storedNoteId = 'dead-note';
    db.getRow.mockImplementation(() => ({
      id: 'r1',
      cells: {},
      noteId: storedNoteId,
    }));
    db.setRowNoteId.mockImplementation((_rowId, noteId) => {
      storedNoteId = noteId;
    });
    // No id resolves to a live note: the backing page was deleted directly.
    h.store.getById.mockReturnValue(undefined);
    h.store.add.mockResolvedValue({ id: 'fresh-note' });

    await c.openRowPage('r1');

    expect(db.setRowNoteId).toHaveBeenNthCalledWith(1, 'r1', null);
    expect(db.setRowNoteId).toHaveBeenNthCalledWith(2, 'r1', 'fresh-note');
    expect(h.store.add).toHaveBeenCalledTimes(1);
    expect(h.routerPush).toHaveBeenCalledWith('/note/fresh-note');
  });
});
