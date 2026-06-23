<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <ui-modal :model-value="state.show" content-class="max-w-sm" persist>
    <template #header>
      <template v-if="state.type !== 'alert'">
        <h3 class="font-semibold text-lg">{{ state.options.title }}</h3>
      </template>
    </template>

    <!-- Alert: centered layout with optional icon -->
    <template v-if="state.type === 'alert'">
      <div class="flex flex-col items-center text-center px-1 pb-2">
        <div
          v-if="state.options.icon"
          class="w-12 h-12 rounded-full flex items-center justify-center mb-3"
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
        <h3 class="font-semibold text-lg mb-1">{{ state.options.title }}</h3>
        <p class="text-neutral-600 dark:text-neutral-200 leading-tight mb-6">
          {{ state.options.body }}
        </p>
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
      </div>
    </template>

    <!-- Confirm / Prompt / Auth -->
    <template v-else>
      <p
        class="text-neutral-600 dark:text-neutral-200 leading-tight break-words overflow-hidden"
      >
        {{ state.options.body }}
      </p>
      <ui-input
        v-if="state.type === 'prompt'"
        v-model="state.input"
        autofocus
        :placeholder="state.options.placeholder"
        :label="state.options.label"
        :password="true"
        class="w-full mt-4"
      ></ui-input>
      <div v-if="isEmpty" class="text-sm text-red-500 mt-2">
        {{ translations.dialog.inputEmpty }}
      </div>
      <div
        v-if="state.type === 'auth'"
        class="w-full mt-4 flex flex-wrap gap-2"
      >
        <ui-checkbox v-for="p in auths" :key="p.label" v-model="p.value">{{
          p.label
        }}</ui-checkbox>
      </div>
      <div
        class="mt-8 flex flex-col-reverse gap-3 md:flex-row md:gap-0 md:space-x-2 rtl:space-x-0"
      >
        <ui-button
          class="w-full md:w-6/12 mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3 rtl:ml-2"
          @click="fireCallback('onCancel')"
        >
          {{
            state.options.cancelText !== 'Cancel'
              ? state.options.cancelText
              : translations.dialog.cancel
          }}
        </ui-button>
        <ui-button
          class="w-full md:w-6/12 mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
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
import { useTranslations } from '../../composable/useTranslations';

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

    function fireCallback(type) {
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

        if (typeof cbReturn === 'boolean') hide = cbReturn;
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
