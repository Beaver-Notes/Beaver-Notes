<template>
  <ui-modal
    :model-value="share.isOpen"
    content-class="max-w-3xl"
    @update:model-value="onOpenChange"
    @close="cancel"
  >
    <template #header>
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-lg font-semibold tracking-tight leading-snug">
            {{ previewTitle || 'Save to Beaver Notes' }}
          </h3>
          <p class="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
            {{ destinationSummary }}
          </p>
        </div>
        <span
          v-if="isOffline"
          class="mt-1 shrink-0 rounded-full bg-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
        >
          Offline — will extract later
        </span>
      </div>
    </template>

    <div class="space-y-3">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          v-if="workspaces.length > 1"
          v-model="share.workspaceId"
          class="h-11 rounded-xl bg-input px-3 text-sm outline-none focus:ring-1 ring-secondary sm:w-48"
        >
          <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
            {{ ws.name }}
          </option>
        </select>
        <ShareFolderPicker v-model="share.folderId" class="flex-1" />
      </div>

      <div
        v-if="share.notice"
        class="rounded-xl bg-amber-100 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
      >
        {{ share.notice }}
      </div>

      <div v-if="itemChips.length" class="space-y-1.5">
        <p
          v-for="chip in itemChips"
          :key="chip.id"
          :title="chip.full"
          class="rounded-xl px-3 py-2 text-xs leading-relaxed break-words"
          :class="chip.error
            ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'"
        >
          {{ chip.label }}
        </p>
      </div>

      <div
        class="min-h-[30dvh] overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"
      >
        <SharePreviewEditor :key="previewKey" :content="previewContent" />
      </div>
    </div>

    <template #actions>
      <ui-button
        class="flex-1 mobile:!min-h-[48px] mobile:w-full"
        @click="cancel"
      >
        Cancel
      </ui-button>
      <ui-button
        class="flex-1 mobile:!min-h-[48px] mobile:w-full"
        variant="primary"
        :loading="share.busy"
        :disabled="share.busy || !share.current || !share.items.length"
        @click="confirmSave"
      >
        {{ share.busy ? 'Saving…' : 'Save note' }}
      </ui-button>
    </template>
  </ui-modal>
</template>

<script>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useShareStore } from '@/store/share';
import { useNoteStore } from '@/store/note';
import { useWorkspaceStore } from '@/store/workspace';
import SharePreviewEditor from './SharePreviewEditor.vue';
import ShareFolderPicker from './ShareFolderPicker.vue';

export default {
  components: { SharePreviewEditor, ShareFolderPicker },
  setup() {
    const share = useShareStore();
    const router = useRouter();
    const workspaceStore = useWorkspaceStore();
    const noteStore = useNoteStore();

    const combined = computed(() => share.buildCombinedDoc());
    const previewTitle = computed(() => combined.value.title);
    const previewContent = computed(() => combined.value.content);
    const isOffline = computed(() => share.items.some((i) => i.offline));
    const previewKey = computed(() => share.items.map((i) => `${i.id}-${!!i.extracted}-${!!i.offline}`).join('|'));
    const workspaces = computed(() => workspaceStore.workspaces || []);

    const targetId = computed(() => share.items[0]?.targetNoteId || null);
    const isAppend = computed(() => !share.notice && !!targetId.value && share.items.every((i) => i.targetNoteId === targetId.value));
    const targetTitle = computed(() => (targetId.value && noteStore.data[targetId.value]?.title) || 'New note');
    const destinationSummary = computed(() =>
      `${isAppend.value ? `Appending to ${targetTitle.value}` : 'New note'} · ${share.items.length} items`);

    const itemChips = computed(() =>
      share.items
        .filter((i) => i.error || i.offline)
        .map((i) => {
          const name = (i.title || i.url || 'Item').slice(0, 60);
          return i.error
            ? { id: i.id, error: true, label: `⚠ ${name}: ${String(i.error).slice(0, 120)}`, full: String(i.error) }
            : { id: i.id, error: false, label: `Offline: ${name} — will extract later`, full: 'Offline — will extract later' };
        }));

    async function confirmSave() {
      const created = await share.saveAll();
      if (created?.length) {
        await share.announceSave(created[0]);
        router.push(`/note/${created[0].id}`);
      }
    }
    function cancel() { share.closeAndClear(); }
    function onOpenChange(value) {
      if (!value) cancel();
    }

    return { share, previewTitle, isOffline, previewKey, previewContent, destinationSummary, itemChips, confirmSave, cancel, onOpenChange, workspaces };
  },
};
</script>
