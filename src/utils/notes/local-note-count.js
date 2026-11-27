import { useNoteStore } from '@/store/note';

export function localNoteCount() {
  try {
    const data = useNoteStore().data;
    return data ? Object.keys(data).length : 0;
  } catch {
    return 0;
  }
}
