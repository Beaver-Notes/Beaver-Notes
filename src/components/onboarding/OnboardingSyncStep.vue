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
          Sync folder
        </h2>
        <p class="text-neutral-600 dark:text-neutral-400">
          Lets select a folder to sync your data with, you can skip this for now
          and set it up later if you change your mind.
        </p>
      </div>

      <div class="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0">
        <div class="flex flex-col p-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p
                class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
              >
                Folder
              </p>
              <p class="text-sm text-neutral-600 dark:text-neutral-400">
                {{
                  syncPath
                    ? 'Beaver Notes sync with this folder.'
                    : 'Choose a folder to sync with.'
                }}
              </p>
            </div>
            <ui-button @click="$emit('chooseSyncPath')">
              {{ syncPath ? 'Change' : 'Choose folder' }}
            </ui-button>
          </div>

          <div
            v-if="syncPath"
            class="flex items-center justify-between gap-3 mt-3"
          >
            <div
              class="rounded-lg bg-neutral-100 px-3 py-2 text-xs break-all text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
            >
              {{ syncPath }}
            </div>
            <ui-button icon variant="danger" @click="$emit('clearSyncPath')">
              <v-remixicon name="riDeleteBin6Line" />
            </ui-button>
          </div>
        </div>

        <button
          class="flex items-center justify-between w-full px-4 py-3 text-left gap-2"
          @click="$emit('toggleAutoSync')"
        >
          <div>
            <span
              class="block text-sm font-semibold text-neutral-800 dark:text-neutral-200"
              >Automatic sync</span
            >
            <span
              class="block text-xs text-neutral-600 dark:text-neutral-400 mt-0.5"
            >
              Lets you sync changes automatically when a folder is configured.
            </span>
          </div>
          <ui-switch :model-value="autoSync" :disabled="!syncPath" />
        </button>
      </div>

      <div
        class="mt-5 flex mobile:flex-col-reverse justify-between gap-4 shrink-0"
      >
        <ui-button @click="$emit('back')">
          <v-remixicon name="riArrowLeftLine" /> Back
        </ui-button>
        <ui-button
          v-if="syncPath"
          variant="primary"
          :loading="savingPreferences"
          @click="$emit('finishFreshOnboarding')"
        >
          <template v-if="!savingPreferences">
            Continue <v-remixicon name="riArrowRightLine" />
          </template>
        </ui-button>
        <ui-button v-else @click="$emit('finishFreshOnboarding')">
          Skip for now
        </ui-button>
      </div>
    </ui-card>
  </div>
</template>

<script>
export default {
  props: {
    syncPath: { type: String, default: '' },
    autoSync: { type: Boolean, default: false },
    savingPreferences: { type: Boolean, default: false },
  },
  emits: [
    'chooseSyncPath',
    'clearSyncPath',
    'toggleAutoSync',
    'finishFreshOnboarding',
    'back',
  ],
};
</script>
