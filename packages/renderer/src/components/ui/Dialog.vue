<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <ui-modal :model-value="state.show" content-class="max-w-sm" persist>
    <template #header>
      <h3 class="font-semibold text-lg">{{ state.options.title }}</h3>
    </template>
    <p
      class="text-gray-600 dark:text-gray-200 leading-tight break-words overflow-hidden"
    >
      {{ state.options.body }}
    </p>
    <ui-input
      v-if="state.type === 'prompt'"
      v-model="state.input"
      autofocus
      :placeholder="state.options.placeholder"
      :label="state.options.label"
      class="w-full mt-4"
    ></ui-input>
    <ui-input
      v-else-if="state.type === 'auth'"
      v-model="state.input"
      autofocus
      :placeholder="state.options.placeholder"
      :label="state.options.label"
      class="w-full mt-4 no-security-text"
    ></ui-input>
    <div v-if="isEmpty" class="text-sm text-red-500 mt-2">Input is empty.</div>
    <div v-if="state.type === 'auth'" class="w-full mt-4 flex flex-wrap gap-2">
      <ui-checkbox v-for="p in auths" :key="p.label" v-model="p.value">{{
        p.label
      }}</ui-checkbox>
    </div>
    <div class="mt-8 flex space-x-2 rtl:space-x-0">
      <ui-button class="w-6/12 rtl:ml-2" @click="fireCallback('onCancel')">
        {{ state.options.cancelText }}
      </ui-button>
      <ui-button
        class="w-6/12"
        :variant="state.options.okVariant"
        @click="fireCallback('onConfirm')"
      >
        {{ state.options.okText }}
      </ui-button>
    </div>
  </ui-modal>
</template>

<script>
import { reactive, watch, ref } from 'vue';
import emitter from 'tiny-emitter/instance';
import { allPermissions } from '../../constants';

const defaultOptions = {
  html: false,
  body: '',
  title: '',
  placeholder: '',
  label: '',
  auth: [],
  allowedEmpty: true,
  okText: 'Confirm',
  okVariant: 'primary',
  cancelText: 'Cancel',
  onConfirm: null,
  onCancel: null,
};

export default {
  setup() {
    const state = reactive({
      show: false,
      type: '',
      input: '',
      options: defaultOptions,
    });

    const auths = ref(allPermissions.map((p) => ({ label: p, value: false })));
    const isEmpty = ref(false);

    emitter.on('show-dialog', (type, options) => {
      state.type = type;
      state.options = {
        ...defaultOptions,
        ...options,
      };

      const checkedAuths = state.options.auth || [];
      for (let i = 0, len = auths.value.length; i < len; i++) {
        const auth = auths.value[i].label;
        auths.value[i].value = checkedAuths.findIndex((a) => a === auth) >= 0;
      }

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
              auths: auths.value.filter((a) => a.value).map((a) => a.label),
            }
          : true;
      let hide = true;

      console.log(type, state.options.allowedEmpty);
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
      auths,
      isEmpty,
    };
  },
};
</script>
