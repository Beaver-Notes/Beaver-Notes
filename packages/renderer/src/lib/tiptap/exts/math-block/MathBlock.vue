<template>
  <node-view-wrapper>
    <div v-if="selected" class="bg-input transition rounded-lg p-2">
      <div class="flex mb-2">
        <textarea
          v-focus="!useKatexMacros"
          :value="node.attrs.content"
          type="textarea"
          :placeholder="translations._idvue.MathPlaceholder || '-'"
          class="bg-transparent flex-1"
          style="direction: ltr"
          @input="updateContent($event, 'content', true)"
          @keydown="handleKeydown"
        />
        <textarea
          v-if="useKatexMacros"
          v-autofocus
          :value="node.attrs.macros"
          placeholder="KaTeX macros"
          class="bg-transparent ml-2 pl-2 border-l flex-1"
          @input="updateContent($event, 'macros', true)"
          @keydown="handleKeydown"
        />
      </div>
      <div
        class="flex border-t items-center pt-2 text-gray-600 dark:text-gray-300"
      >
        <img src="@/assets/svg/katex.svg" width="48" style="margin: 0" />
        <div class="flex-grow"></div>
        <p v-if="isContentChange" class="text-sm" style="margin: 0">
          <strong>{{ translations._idvue.exit }}</strong>
        </p>
        <v-remixicon
          v-tooltip="'KaTeX Macros (Ctrl+Shift+M)'"
          :class="{ 'text-primary': useKatexMacros }"
          name="riSettings3Line"
          class="ml-2 cursor-pointer"
          @click="useKatexMacros = !useKatexMacros"
        />
      </div>
    </div>
    <p
      ref="contentRef"
      :class="{ 'dark:text-purple-400 text-purple-500': selected }"
    ></p>
  </node-view-wrapper>
</template>
<script>
import { shallowReactive, onMounted, ref, nextTick } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import katex from 'katex';

export default {
  components: {
    NodeViewWrapper,
  },
  directives: {
    focus: (el, { value = true }) => {
      if (value) el.focus();
    },
  },
  props: nodeViewProps,
  setup(props) {
    const contentRef = ref(null);
    const useKatexMacros = ref(false);
    const isContentChange = ref(false);

    function renderContent() {
      let macros = {};

      try {
        macros = JSON.parse(props.node.attrs.macros);
      } catch (error) {
        // Do nothing
      }

      katex.render(props.node.attrs.content || 'Empty', contentRef.value, {
        macros,
        displayMode: true,
        throwOnError: false,
      });
    }

    // Debounce function to limit the rate of calling renderContent
    const debounce = (func, delay) => {
      let timer;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
      };
    };

    const debouncedRenderContent = debounce(renderContent, 300);

    function updateContent({ target: { value } }, key, isRenderContent) {
      isContentChange.value = true;
      props.updateAttributes({ [key]: value });

      if (isRenderContent) {
        // Use nextTick to ensure DOM updates are applied before rendering content
        nextTick(() => {
          debouncedRenderContent();
        });
      }
    }

    function handleKeydown(event) {
      const { ctrlKey, shiftKey, metaKey, key } = event;

      const isModEnter = (ctrlKey || metaKey) && key === 'Enter';
      const isMacrosShortcut = (ctrlKey || metaKey) && shiftKey && key === 'M';
      const isNotEdited =
        props.editor.isActive('mathBlock') &&
        !isContentChange.value &&
        ['ArrowUp', 'ArrowDown'].includes(key);

      if (isModEnter || isNotEdited) {
        props.editor.commands.focus();
        isContentChange.value = false;
        useKatexMacros.value = false;
      } else if (isMacrosShortcut) {
        useKatexMacros.value = !useKatexMacros.value;
      }
    }

    onMounted(() => {
      props.updateAttributes({ init: 'true' });
      renderContent();
    });

    const translations = shallowReactive({
      _idvue: {
        exit: '_idvue.exit',
        MathPlaceholder: '_idvue.MathPlaceholder',
      },
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../../../../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    return {
      contentRef,
      handleKeydown,
      translations,
      updateContent,
      useKatexMacros,
      isContentChange,
    };
  },
};
</script>
