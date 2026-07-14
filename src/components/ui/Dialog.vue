<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <ui-modal :model-value="state.show" content-class="max-w-md" persist>
    <!-- Alert -->
    <template v-if="state.type === 'alert'">
      <div class="text-left mb-6 mobile:text-center">
        <div
          class="flex flex-row items-start gap-7 mb-2 mobile:flex-col mobile:items-center mobile:gap-4 mobile:mt-6"
        >
          <div v-if="state.options.icon" class="flex-shrink-0">
            <div
              class="w-12 h-12 rounded-lg flex items-center justify-center"
              :class="
                state.options.okVariant === 'danger'
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-neutral-100 dark:bg-neutral-700'
              "
            >
              <v-remixicon
                :name="state.options.icon"
                size="24"
                :class="
                  state.options.okVariant === 'danger'
                    ? 'text-red-500'
                    : 'text-neutral-600 dark:text-neutral-300'
                "
              />
            </div>
          </div>
          <h3 class="font-semibold text-lg">{{ state.options.title }}</h3>
        </div>
        <p class="text-neutral-600 dark:text-neutral-200 leading-relaxed">
          {{ state.options.body }}
        </p>
      </div>
      <ui-button
        class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
        :variant="state.options.okVariant"
        @click="fireCallback('onConfirm')"
      >
        {{
          state.options.okText !== 'Confirm'
            ? state.options.okText
            : translations.dialog.close || 'Close'
        }}
      </ui-button>
    </template>

    <!-- Confirm / Prompt / Auth -->
    <template v-else>
      <div
        class="flex flex-col items-start text-left mobile:flex-col mobile:items-center mobile:text-center gap-3 mb-4 mobile:mt-6"
      >
        <div v-if="state.options.icon" class="flex-shrink-0">
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center"
            :class="
              state.options.okVariant === 'danger'
                ? 'bg-red-100 dark:bg-red-900/30'
                : 'bg-neutral-100 dark:bg-neutral-700'
            "
          >
            <v-remixicon
              :name="state.options.icon"
              size="24"
              :class="
                state.options.okVariant === 'danger'
                  ? 'text-red-500'
                  : 'text-neutral-600 dark:text-neutral-300'
              "
            />
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-semibold text-lg mb-3">{{ state.options.title }}</h3>

          <div v-if="state.options.body" class="mb-4">
            <p
              class="text-neutral-600 dark:text-neutral-200 leading-relaxed break-words overflow-hidden"
            >
              {{ state.options.body }}
            </p>
          </div>

          <ui-input
            v-if="state.type === 'prompt'"
            v-model="state.input"
            autofocus
            :placeholder="state.options.placeholder"
            :label="state.options.label"
            :password="state.options.password"
            class="w-full"
          ></ui-input>
          <div v-if="isEmpty" id="dialog-error" class="text-sm text-red-500 mt-2" role="alert">
            {{ translations.dialog.inputEmpty }}
          </div>
          <div v-if="state.type === 'auth'" class="w-full flex flex-wrap gap-2">
            <ui-checkbox v-for="p in auths" :key="p.label" v-model="p.value">{{
              p.label
            }}</ui-checkbox>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex gap-3 mobile:flex-col-reverse">
        <ui-button
          class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
          @click="fireCallback('onCancel')"
        >
          {{
            state.options.cancelText !== 'Cancel'
              ? state.options.cancelText
              : translations.dialog.cancel
          }}
        </ui-button>
        <ui-button
          class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
          :variant="state.options.okVariant"
          @click="fireCallback('onConfirm')"
        >
          {{
            state.options.okText !== 'Confirm'
              ? state.options.okText
              : translations.dialog.confirm
          }}
        </ui-button>
      </div>
    </template>
  </ui-modal>
</template>

<script>
import { reactive, watch, ref } from 'vue';
import emitter from 'tiny-emitter/instance';
import { useTranslations } from '@/composable/useTranslations';

const defaultOptions = {
  html: false,
  body: '',
  title: '',
  placeholder: '',
  label: '',
  allowedEmpty: true,
  okText: 'Confirm',
  okVariant: 'primary',
  cancelText: 'Cancel',
  onConfirm: null,
  onCancel: null,
  icon: '',
};

export default {
  setup() {
    const state = reactive({
      show: false,
      type: '',
      input: '',
      options: defaultOptions,
    });

    const isEmpty = ref(false);
    const { translations } = useTranslations();

    emitter.on('show-dialog', (type, options) => {
      state.type = type;
      state.options = {
        ...defaultOptions,
        ...options,
      };

      state.show = true;
      isEmpty.value = false;
    });

    async function fireCallback(type) {
      const callback = state.options[type];
      const param =
        state.type === 'prompt'
          ? state.input
          : state.type === 'auth'
          ? {
              name: state.input,
            }
          : true;
      let hide = true;

      if (type !== 'onCancel' && !state.options.allowedEmpty) {
        if (state.input == null || state.input === '') {
          isEmpty.value = true;
          return;
        }
      }

      if (callback) {
        const cbReturn = callback(param);

        if (cbReturn instanceof Promise) {
          try {
            await cbReturn;
          } catch (e) {
            console.error(e);
          }
        } else if (typeof cbReturn === 'boolean') {
          hide = cbReturn;
        }
      }

      if (hide) {
        state.options = defaultOptions;
        state.show = false;
        state.input = '';
      }
      isEmpty.value = false;
    }

    function keyupHandler({ code }) {
      if (code === 'Enter') {
        fireCallback('onConfirm');
      } else if (code === 'Escape') {
        fireCallback('onCancel');
      }
    }

    watch(
      () => state.show,
      (value) => {
        if (value) {
          window.addEventListener('keyup', keyupHandler);
        } else {
          window.removeEventListener('keyup', keyupHandler);
        }
      }
    );

    return {
      state,
      fireCallback,
      isEmpty,
      translations,
    };
  },
};
</script>
