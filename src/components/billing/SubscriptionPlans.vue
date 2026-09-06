<template>
  <div class="flex flex-col gap-3">
    <p v-if="!signedIn" class="text-sm text-neutral-600 dark:text-neutral-400 text-center">
      Sign in to see subscription options.
    </p>
    <template v-else-if="!isPaid">
      <div class="flex gap-2 justify-center">
        <ui-button
          v-for="i in ['monthly', 'yearly']"
          :key="i"
          :variant="interval === i ? 'primary' : 'secondary'"
          @click="$emit('update:interval', i)"
        >{{ i === 'monthly' ? 'Monthly' : 'Yearly' }}</ui-button>
      </div>
      <p v-if="loading" class="text-sm text-center text-neutral-500">Loading prices…</p>
      <p v-else-if="error" class="text-sm text-center text-red-500">{{ error }}</p>
      <ui-card v-for="row in rows" :key="row.key" hover>
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium capitalize">{{ row.plan }} {{ interval }}</p>
            <p class="text-xs text-neutral-500">{{ priceFor(row) }}</p>
          </div>
          <ui-button
            variant="primary"
            :data-plan="row.plan"
            @click="$emit('select', row.plan, interval)"
          >Choose</ui-button>
        </div>
      </ui-card>
    </template>
    <p v-else class="text-sm text-center text-neutral-600 dark:text-neutral-400">
      You're on {{ currentPlan }}. You're all set.
    </p>
  </div>
</template>

<script>
import { computed } from 'vue';
import { MOBILE_PLANS } from '@/composable/useIapBilling';

export default {
  name: 'SubscriptionPlans',
  props: {
    products: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    error: { type: String, default: '' },
    interval: { type: String, default: 'monthly' },
    isPaid: { type: Boolean, default: false },
    currentPlan: { type: String, default: 'free' },
    signedIn: { type: Boolean, default: false },
  },
  emits: ['select', 'update:interval'],
  setup(props) {
    const rows = computed(() =>
      MOBILE_PLANS.filter((p) => p.interval === props.interval).map((p) => ({
        ...p,
        key: `${p.plan}-${p.interval}`,
      })),
    );
    function priceFor(row) {
      const match = props.products.find(
        (p) => p.productId === `com.beavernotes.${row.plan}.${row.interval}`,
      );
      return match?.formattedPrice || '';
    }
    return { rows, priceFor };
  },
};
</script>
