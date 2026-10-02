<template>
  <ui-modal :model-value="modelValue" content-class="max-w-md" @update:model-value="$emit('update:modelValue', $event)">
    <template #header>
      <h3 class="text-lg font-semibold">Choose a plan</h3>
    </template>
    <SubscriptionPlans
      :products="products"
      :loading="loading"
      :error="error"
      :busy="busy"
      :interval="interval"
      :is-paid="isPaid"
      :current-plan="currentPlan"
      :signed-in="signedIn"
      @select="(...a) => $emit('select', ...a)"
      @update:interval="$emit('update:interval', $event)"
    />
    <div v-if="signedIn" class="mt-3 flex justify-center">
      <ui-button variant="secondary" size="sm" :loading="busy" :disabled="busy" @click="$emit('restore')">
        Restore purchases
      </ui-button>
    </div>
  </ui-modal>
</template>

<script>
import SubscriptionPlans from './SubscriptionPlans.vue';

export default {
  name: 'SubscriptionDialog',
  components: { SubscriptionPlans },
  props: {
    modelValue: { type: Boolean, default: false },
    products: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    error: { type: String, default: '' },
    busy: { type: Boolean, default: false },
    interval: { type: String, default: 'monthly' },
    isPaid: { type: Boolean, default: false },
    currentPlan: { type: String, default: 'free' },
    signedIn: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'select', 'update:interval', 'restore'],
};
</script>
