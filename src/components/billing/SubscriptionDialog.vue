<template>
  <ui-modal :model-value="modelValue" content-class="max-w-md" @update:model-value="$emit('update:modelValue', $event)">
    <template #header>
      <h3 class="text-lg font-semibold">Choose a plan</h3>
    </template>
    <SubscriptionPlans
      :products="products"
      :loading="loading"
      :error="error"
      :interval="interval"
      :is-paid="isPaid"
      :current-plan="currentPlan"
      :signed-in="signedIn"
      @select="(...a) => $emit('select', ...a)"
      @update:interval="$emit('update:interval', $event)"
    />
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
    interval: { type: String, default: 'monthly' },
    isPaid: { type: Boolean, default: false },
    currentPlan: { type: String, default: 'free' },
    signedIn: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'select', 'update:interval'],
};
</script>
