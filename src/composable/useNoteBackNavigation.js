import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * Composable that manages back-navigation heuristics for the note page.
 */
export function useNoteBackNavigation() {
  const route = useRoute();
  const router = useRouter();

  const showBack = computed(() => {
    const back = router.options.history.state.back;
    if (!back) return false;
    if (back === '/' || back.includes('/#/?')) return false;
    return true;
  });

  function goBack() {
    const from = router.options.history.state.back;

    if (!from) {
      router.push('/');
      return;
    }

    if (from.includes('/folder/') || from.includes('/archive/')) {
      router.go(-1);
      return;
    }

    if (from.includes('/note/')) {
      router.go(-1);
      return;
    }

    router.push('/');
  }

  return { showBack, goBack };
}
