<script setup>
import TextCell from './TextCell.vue'
import NumberCell from './NumberCell.vue'
import SelectCell from './SelectCell.vue'
import DateCell from './DateCell.vue'
import UiCheckbox from '@/components/ui/Checkbox.vue'

const props = defineProps({
  column: { type: Object, required: true },
  row: { type: Object, required: true },
  editing: Boolean,
  computed: { type: null, default: null },
})
const emit = defineEmits(['update'])

const READONLY = ['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id']
const TEXTY = ['title', 'rich_text', 'url', 'email', 'phone_number']

function value() {
  return props.row.cells?.[props.column.id] ?? null
}
function commit(v) {
  emit('update', { [props.column.id]: v })
}
function onCellClick(e) {
  if (e.target.closest('label, input')) return
  commit(!value())
}
</script>

<template>
  <TextCell
    v-if="TEXTY.includes(column.type)"
    :value="value()"
    :kind="column.type"
    :editing="editing"
    :name="column.name"
    @commit="commit"
  />
  <NumberCell
    v-else-if="column.type === 'number'"
    :value="value()"
    :config="column.config"
    :editing="editing"
    :name="column.name"
    @commit="commit"
  />
  <SelectCell
    v-else-if="['select', 'multi_select', 'status'].includes(column.type)"
    :column="column"
    :value="value()"
    :editing="editing"
    @commit="commit"
  />
  <DateCell
    v-else-if="column.type === 'date'"
    :value="value()"
    :editing="editing"
    :name="column.name"
    @commit="commit"
  />
  <!-- label clicks are handled by the checkbox's own change; the cell handles the rest.
       Guarding prevents the label's forwarded click from double-toggling. -->
  <div
    v-else-if="column.type === 'checkbox'"
    data-test="checkbox-cell"
    class="flex h-full cursor-pointer items-center px-2"
    @click="onCellClick"
  >
    <UiCheckbox
      class="h-full w-full"
      :model-value="!!value()"
      :aria-label="column.name"
      @change="commit"
    />
  </div>
  <span v-else-if="READONLY.includes(column.type)" class="block truncate px-2 py-1 text-sm opacity-80">
    {{ computed != null ? String(computed) : '' }}
  </span>
  <span v-else class="px-2 text-sm opacity-40">—</span>
</template>
