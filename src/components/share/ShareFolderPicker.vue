<template>
  <select
    class="bg-input rounded-lg h-9 px-2 text-sm w-full outline-none focus:ring-1 ring-secondary"
    :value="modelValue || ''"
    @change="$emit('update:modelValue', $event.target.value || null)"
  >
    <option value="">No folder</option>
    <option v-for="f in topLevelFolders" :key="f.id" :value="f.id">{{ f.name }}</option>
  </select>
</template>

<script>
import { computed } from 'vue';
import { useFolderStore } from '@/store/folder';

export default {
  props: { modelValue: { type: String, default: null } },
  emits: ['update:modelValue'],
  setup() {
    const folderStore = useFolderStore();
    const topLevelFolders = computed(() =>
      Object.values(folderStore.data).filter((f) => !f.parentId && !f.isArchived)
    );
    return { topLevelFolders };
  },
};
</script>
