<template>
  <div
    class="ob-screen flex flex-col items-center justify-center mobile:justify-end w-full"
  >
    <ui-card
      class="w-full max-w-lg mobile:max-w-full max-h-[80dvh] flex flex-col mobile:rounded-b-none mobile:border-b-0"
    >
      <div class="flex flex-col items-center gap-2 my-8 text-center shrink-0">
        <h2
          class="text-3xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
        >
          {{ t?.settings?.encryptionPassphrase || 'Encryption passphrase' }}
        </h2>
        <p class="text-neutral-600 dark:text-neutral-400">
          {{
            t?.onboarding?.passwordDescription ||
            'Encryption is built into Beaver Notes. Set a passphrase to protect every note and asset on this device.'
          }}
        </p>
      </div>

      <div class="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0 px-1">
        <ui-input
          :model-value="modelValue"
          password
          :placeholder="t?.settings?.password || 'Passphrase'"
          @update:model-value="$emit('update:modelValue', $event)"
        />

        <div class="h-1 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-300"
            :class="strengthBarClass"
            :style="{ width: strengthPercent + '%' }"
          />
        </div>
        <p class="text-xs" :class="strengthTextClass">
          {{ strengthLabel }}
        </p>

        <ui-input
          :model-value="confirmValue"
          password
          :placeholder="t?.onboarding?.confirmPassword || 'Confirm passphrase'"
          @update:model-value="$emit('update:confirmValue', $event)"
        />

        <p
          v-if="error"
          class="text-xs text-red-500 dark:text-red-400 text-center"
        >
          {{ error }}
        </p>

        <div class="mt-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
          <p class="text-xs text-amber-700 dark:text-amber-300">
            <v-remixicon name="riErrorWarningLine" size="14" class="inline mr-1" />
            {{
              t?.onboarding?.passwordWarning ||
              'This passphrase cannot be recovered if forgotten. Store it in a password manager.'
            }}
          </p>
        </div>
      </div>

      <div class="mt-5 flex mobile:flex-col-reverse justify-end gap-4 shrink-0">
        <slot name="next" />
      </div>
    </ui-card>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useTranslations } from '@/composable/useTranslations';

function assessStrength(pw) {
  if (!pw) return { level: 0, label: '', percent: 0 };
  const len = pw.length;
  if (len < 6) return { level: 0, label: 'Too short', percent: Math.max(8, len * 4) };

  let score = 0;
  if (len >= 8) score += 1;
  if (len >= 12) score += 1;
  if (len >= 16) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1;

  if (score <= 1) return { level: 1, label: 'Weak', percent: 25 };
  if (score === 2) return { level: 2, label: 'Fair', percent: 50 };
  if (score <= 4) return { level: 3, label: 'Good', percent: 75 };
  return { level: 4, label: 'Strong', percent: 100 };
}

export default {
  props: {
    modelValue: { type: String, default: '' },
    confirmValue: { type: String, default: '' },
    error: { type: String, default: '' },
    loading: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'update:confirmValue'],
  setup(props) {
    const { translations } = useTranslations();
    const t = translations;

    const strength = computed(() => assessStrength(props.modelValue));
    const strengthPercent = computed(() => strength.value.percent);
    const strengthLabel = computed(() => strength.value.label);
    const strengthBarClass = computed(() => {
      const level = strength.value.level;
      if (level === 0) return 'bg-red-400';
      if (level === 1) return 'bg-orange-400';
      if (level === 2) return 'bg-yellow-400';
      if (level === 3) return 'bg-lime-400';
      return 'bg-green-400';
    });
    const strengthTextClass = computed(() => {
      const level = strength.value.level;
      if (level === 0) return 'text-red-500';
      if (level === 1) return 'text-orange-500';
      if (level === 2) return 'text-yellow-600';
      if (level === 3) return 'text-lime-600';
      return 'text-green-600';
    });

    return { t, strengthPercent, strengthLabel, strengthBarClass, strengthTextClass };
  },
};
</script>
