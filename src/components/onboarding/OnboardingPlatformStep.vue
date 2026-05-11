<template>
  <ui-card class="w-full max-w-lg">
    <div class="flex flex-col items-center gap-2 my-8 text-center">
      <h2 class="text-3xl font-semibold tracking-tight ob-heading-text">
        Import from apps
      </h2>
      <p class="ob-body-text">Choose which app to migrate from.</p>
    </div>

    <div class="flex flex-col gap-2">
      <ui-card
        v-for="platform in visiblePlatforms"
        :key="platform.id"
        tag="button"
        padding="p-0"
        class="w-full text-left"
        :class="modelValue === platform.id ? 'ring-2 ring-primary' : ''"
        @click="handleSelect(platform.id)"
      >
        <div class="flex items-center gap-4 p-4">
          <div
            class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            :style="platform.iconBg ? { background: platform.iconBg } : {}"
            :class="platform.iconClass || ''"
          >
            <img
              v-if="platform.useLogoImg"
              :src="logoUrl"
              alt="Beaver Notes"
              class="w-6 h-6 object-contain"
            />
            <v-remixicon
              v-else
              :name="platform.icon"
              :class="platform.iconColor || ''"
            />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-0.5">
              <h3 class="font-semibold text-sm ob-heading-text">
                {{ platform.label }}
              </h3>
              <span
                v-if="platform.badge"
                class="inline-flex items-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5"
                >{{ platform.badge }}</span
              >
            </div>
            <p class="text-sm ob-body-text">{{ platform.description }}</p>
          </div>
          <v-remixicon
            v-if="modelValue === platform.id"
            name="riCheckLine"
            class="shrink-0 text-primary"
          />
          <v-remixicon
            v-else
            name="riArrowRightLine"
            class="shrink-0 opacity-30"
          />
        </div>
      </ui-card>
    </div>

    <div class="mt-5 flex justify-between gap-4">
      <slot name="back" />
      <slot name="next" />
    </div>
  </ui-card>
</template>

<script setup>
import { computed } from 'vue';
import { ALL_PLATFORMS } from '@/utils/onboarding-platforms';

const props = defineProps({
  modelValue: { type: String, default: null },
  isMacOS: { type: Boolean, default: false },
  logoUrl: { type: String, required: true },
});

const emit = defineEmits(['update:modelValue', 'select']);

function handleSelect(platformId) {
  emit('update:modelValue', platformId);
  emit('select', platformId);
}

const visiblePlatforms = computed(() =>
  ALL_PLATFORMS.filter((platform) => !platform.macOnly || props.isMacOS)
);
</script>
