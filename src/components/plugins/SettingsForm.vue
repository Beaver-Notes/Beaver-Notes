<template>
  <div v-if="schema" class="space-y-4">
    <div v-for="(field, key) in schema" :key="key" class="space-y-1">
      <template v-if="field.type === 'boolean'">
        <ui-switch v-model="values[key]" :id="`setting-${pluginId}-${key}`">
          <span class="text-sm font-medium">{{ field.label || key }}</span>
        </ui-switch>
        <p v-if="field.description" class="text-xs text-neutral-500 ml-1">
          {{ field.description }}
        </p>
      </template>

      <template v-else-if="field.type === 'select'">
        <ui-select
          v-model="values[key]"
          :label="field.label || key"
          :options="(field.options || []).map(o => ({ text: typeof o === 'string' ? o : o.text || o.value, value: typeof o === 'string' ? o : o.value }))"
          @change="save(key, values[key])"
        />
      </template>

      <template v-else-if="field.type === 'number'">
        <ui-input
          v-model="values[key]"
          :label="field.label || key"
          :type="'number'"
          :placeholder="field.placeholder || ''"
          @change="save(key, values[key])"
        />
      </template>

      <template v-else>
        <ui-input
          v-model="values[key]"
          :label="field.label || key"
          :type="field.secret ? 'password' : 'text'"
          :placeholder="field.placeholder || ''"
          :password="field.secret"
          @change="save(key, values[key])"
        />
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { createPluginStorage } from '@/plugins/PluginStorage';

const props = defineProps({
  schema: { type: Object, required: true },
  pluginId: { type: String, required: true },
});

const storage = createPluginStorage(props.pluginId);
const values = ref({});

async function initValues() {
  const defaults = {};
  for (const [key, field] of Object.entries(props.schema)) {
    const stored = await storage.get(key);
    defaults[key] = stored !== undefined ? stored : (field.default || (field.type === 'boolean' ? false : ''));
  }
  values.value = defaults;
}

async function save(key, value) {
  await storage.set(key, value);
}

onMounted(() => {
  initValues();
});
</script>
