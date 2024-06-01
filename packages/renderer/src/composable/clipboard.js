import { ref, onUnmounted } from 'vue';
export const useClipboard = () => {
  /** @description 0 no copy 1 copied 2 copied error */
  const copyState = ref(0);
  let timer;
  const recover = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      copyState.value = 0;
      timer = null;
    }, 2000);
  };
  // eslint-disable-next-line no-undef
  onUnmounted(() => {
    timer && clearTimeout(timer);
  });

  /**
   * @param {string} code
   */
  const copyToClipboard = (code) => {
    const clipboard = navigator.clipboard;
    if (clipboard != null) {
      clipboard
        .writeText(code)
        .then(() => {
          copyState.value = 1;
          recover();
        })
        .catch((e) => {
          console.error(e);
          copyState.value = 2;
          recover();
        });
    } else {
      if (document.execCommand) {
        const el = document.createElement('textarea');
        el.value = code;
        document.body.append(el);

        el.select();
        el.setSelectionRange(0, code.length);

        if (document.execCommand('copy')) {
          copyState.value = 1;
        }

        el.remove();
      } else {
        copyState.value = 2;
      }
      recover();
    }
  };
  return {
    copyState,
    copyToClipboard,
  };
};
