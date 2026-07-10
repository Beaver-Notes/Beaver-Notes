<template>
  <div
    class="ob-screen flex flex-col items-center justify-center mobile:justify-end w-full"
  >
    <ui-card
      class="w-full max-w-lg mobile:max-w-full max-h-[80dvh] flex flex-col mobile:rounded-b-none mobile:border-b-0"
    >
      <div
        class="flex flex-col items-center gap-2 my-6 text-center shrink-0 px-2"
      >
        <div
          class="shrink-0 w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
        >
          <v-remixicon name="riUserLine" size="24" />
        </div>
        <h2
          class="text-3xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
        >
          {{ translations.account?.onboardingTitle || 'Sign in (optional)' }}
        </h2>
        <p
          class="text-sm text-neutral-600 dark:text-neutral-400 max-w-sm leading-relaxed"
        >
          {{
            translations.account?.onboardingBody ||
            'A Beaver Account lets your notes follow you across devices with end-to-end encrypted cloud sync. Local-only mode stays fully working without one.'
          }}
        </p>
      </div>

      <ul
        class="flex-1 min-h-0 overflow-y-auto px-2 space-y-2 text-sm text-neutral-700 dark:text-neutral-300"
      >
        <li class="flex items-start gap-3">
          <v-remixicon
            name="riShieldCheckLine"
            class="mt-0.5 text-primary"
            size="18"
          />
          <span>{{
            translations.account?.onboardingBulletPrivacy ||
            'Zero-knowledge encryption — the server only sees encrypted blobs.'
          }}</span>
        </li>
        <li class="flex items-start gap-3">
          <v-remixicon
            name="riFingerprintLine"
            class="mt-0.5 text-primary"
            size="18"
          />
          <span>{{
            translations.account?.onboardingBulletAuth ||
            'Sign in with a passkey or a password. QuickConnect works across devices.'
          }}</span>
        </li>
        <li class="flex items-start gap-3">
          <v-remixicon
            name="riStarLine"
            class="mt-0.5 text-primary"
            size="18"
          />
          <span>{{
            translations.account?.onboardingBulletFree ||
            'A free account keeps your notes on this device only. Cloud sync is part of Basic and up.'
          }}</span>
        </li>
      </ul>

      <div
        class="mt-5 flex mobile:flex-col-reverse justify-between gap-3 shrink-0"
      >
        <ui-button @click="$emit('back')">
          <v-remixicon name="riArrowLeftLine" /> Back
        </ui-button>
        <div class="flex gap-3 mobile:flex-col-reverse">
          <ui-button @click="$emit('skip')">{{
            translations.account?.skip || 'Skip for now'
          }}</ui-button>
          <ui-button
            variant="primary"
            :loading="busy"
            :disabled="busy"
            @click="$emit('signIn')"
          >
            <template v-if="!busy">
              {{
                translations.account?.onboardingSignIn ||
                'Sign in or create account'
              }}
              <v-remixicon name="riArrowRightLine" class="ml-1" />
            </template>
          </ui-button>
        </div>
      </div>
    </ui-card>
  </div>
</template>

<script>
import { useTranslations } from '@/composable/useTranslations';

export default {
  props: {
    busy: { type: Boolean, default: false },
  },
  emits: ['back', 'skip', 'signIn'],
  setup() {
    const { translations } = useTranslations();
    return { translations };
  },
};
</script>
