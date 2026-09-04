<template>
  <!-- Block styles live in HomeNoteCard.vue <style> (unscoped, global). -->
  <div v-if="blocks?.length" class="note-card-preview-stack">
    <div
      v-for="(block, index) in blocks"
      :key="`${block.kind}-${index}-${block.text || block.label || ''}`"
      :class="[
        'note-card-preview-block',
        `is-${block.kind}`,
        block.tone ? `tone-${block.tone}` : '',
        block.checked ? 'is-checked' : '',
      ]"
    >
      <template v-if="block.kind === 'image'">
        <img
          class="note-card-preview-image"
          :src="block.src"
          :alt="block.alt || 'Note preview image'"
          decoding="async"
        />
      </template>

      <template v-else-if="block.kind === 'table'">
        <div class="note-card-preview-table-wrap">
          <table class="note-card-preview-table">
            <tbody>
              <tr
                v-for="(row, rowIndex) in block.rows"
                :key="`row-${rowIndex}`"
                class="note-card-preview-table-row"
              >
                <component
                  :is="cell.isHeader ? 'th' : 'td'"
                  v-for="(cell, cellIndex) in row"
                  :key="`cell-${rowIndex}-${cellIndex}`"
                  class="note-card-preview-table-cell"
                >
                  {{ cell.text }}
                </component>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else-if="block.kind === 'media'">
        <span class="note-card-preview-media-icon" aria-hidden="true">
          <v-remixicon :name="mediaIconForTone(block.tone)" size="16" />
        </span>
        <span class="note-card-preview-media-copy">
          <span class="note-card-preview-media-label">
            {{ block.label }}
          </span>
          <span v-if="block.text" class="note-card-preview-media-text">
            {{ block.text }}
          </span>
        </span>
      </template>

      <template v-else-if="block.kind === 'task'">
        <span
          class="note-card-preview-check"
          :data-checked="block.checked ? 'true' : 'false'"
        >
          <v-remixicon
            v-if="block.checked"
            name="riCheckLine"
            size="13"
            class="note-card-preview-check-icon"
          />
        </span>
        <span class="note-card-preview-task-text truncate">{{
          block.text
        }}</span>
      </template>

      <template v-else>
        {{ block.text }}
      </template>
    </div>

    <div v-if="meta" class="note-card-preview-meta">
      {{ meta }}
    </div>
  </div>

  <div v-else class="note-card-preview-empty">
    {{ emptyText }}
  </div>
</template>

<script setup>
import { mediaIconForTone } from '@/utils/note/cardPreview.js';

defineProps({
  blocks: {
    type: Array,
    default: () => [],
  },
  meta: {
    type: String,
    default: '',
  },
  emptyText: {
    type: String,
    default: 'Start writing...',
  },
});
</script>
