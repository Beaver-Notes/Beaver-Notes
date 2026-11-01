import { ref } from 'vue';

const editingPapers = new Set();

export const isPaperEditing = ref(false);

export function setPaperEditing(source, editing) {
  if (!source) return;
  if (editing) editingPapers.add(source);
  else editingPapers.delete(source);
  isPaperEditing.value = editingPapers.size > 0;
}
