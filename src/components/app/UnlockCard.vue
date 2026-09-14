<template>
  <div class="w-full max-w-sm text-center">
    <v-remixicon name="riLockLine" size="32" class="mx-auto text-neutral-400 dark:text-neutral-500" />
    <h2 class="mt-3 text-xl font-bold tracking-tight text-neutral-800 dark:text-neutral-200">
      {{ title }}
    </h2>
    <p v-if="body" class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{{ body }}</p>
    <p v-if="hint" class="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{{ hint }}</p>
    <ui-input
      :model-value="password"
      :password="true"
      :placeholder="placeholder"
      class="mt-4 w-full"
      :disabled="busy"
      @update:model-value="$emit('update:password', $event)"
      @keyup.enter="$emit('unlock')"
    />
    <p v-if="error" id="encryption-gate-error" class="mt-2 text-xs text-red-500 dark:text-red-400 text-center" role="alert">{{ error }}</p>
    <div class="mt-4 flex flex-col gap-2">
      <ui-button variant="primary" class="w-full" :loading="busy" :disabled="requirePassword ? (!password || busy) : busy" @click="$emit('unlock')">
        {{ unlockLabel }}
      </ui-button>
      <ui-button v-if="biometricAvailable" variant="secondary" class="w-full" :loading="biometricBusy" @click="$emit('unlockBiometrics')">
        {{ biometricLabel }}
      </ui-button>
      <router-link v-if="showClose" :to="closeTo" class="w-full">
        <ui-button variant="secondary" class="w-full">{{ closeLabel }}</ui-button>
      </router-link>
    </div>
    <button
      v-if="showRecovery"
      class="mt-3 text-xs text-neutral-400 dark:text-neutral-500 hover:text-primary transition-colors"
      @click="$emit('recover')"
    >
      {{ recoveryLabel }}
    </button>
  </div>
</template>

<script>
export default {
  props: {
    title: { type: String, required: true },
    body: { type: String, default: '' },
    hint: { type: String, default: '' },
    password: { type: String, default: '' },
    placeholder: { type: String, default: 'Passphrase' },
    error: { type: String, default: '' },
    busy: { type: Boolean, default: false },
    biometricBusy: { type: Boolean, default: false },
    biometricAvailable: { type: Boolean, default: false },
    biometricLabel: { type: String, default: 'Unlock with Touch ID' },
    unlockLabel: { type: String, default: 'Unlock' },
    requirePassword: { type: Boolean, default: false },
    showRecovery: { type: Boolean, default: false },
    recoveryLabel: { type: String, default: 'Forgot passphrase? Use recovery code' },
    showClose: { type: Boolean, default: false },
    closeLabel: { type: String, default: 'Close' },
    closeTo: { type: String, default: '/' },
  },
  emits: ['update:password', 'unlock', 'unlockBiometrics', 'recover'],
};
</script>
