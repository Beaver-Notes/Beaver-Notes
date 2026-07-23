<template>
  <div class="note-headings-progress">
    <div
      class="fixed right-4 top-1/2 -translate-y-1/2 z-40"
      @mouseenter="onEnter"
      @mouseleave="onLeave"
      @click="onClickRail"
    >
      <div
        ref="railRef"
        class="w-8 relative flex flex-col items-end gap-1.5 overflow-hidden py-1.5 max-h-[100px]"
      >
        <button
          v-for="(item, i) in visibleHeadings"
          :key="item.id"
          :ref="
            (el) => {
              if (el) setPillRef(i, el);
            }
          "
          class="flex-shrink-0 rounded-full cursor-pointer transition-[width,height,background-color,box-shadow] duration-300 ease-[var(--ease-snappy)]"
          :class="
            item === activeHeading
              ? 'w-3 h-1.5 bg-primary ring-2 ring-white/60 dark:ring-neutral-900/60'
              : 'w-2 h-1 bg-neutral-400/15 hover:bg-neutral-400/30'
          "
          @click="onPillClick(item, $event)"
        />
      </div>
    </div>

    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-300 ease-[var(--ease-snappy)]"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-200 ease-[var(--ease-snappy)]"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="showMenu"
          ref="popoverRef"
          class="fixed z-50 w-64 rounded-xl border bg-white dark:bg-neutral-900 shadow-xl overflow-hidden origin-right"
          :style="popoverStyle"
          @mouseenter="onEnter"
          @mouseleave="onLeave"
        >
          <div class="p-2 border-b dark:border-neutral-700">
            <input
              v-model="search"
              type="text"
              :placeholder="translations.noteActions?.searchHeadings || 'Search headings…'"
              class="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-transparent px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary placeholder:text-neutral-400"
            />
          </div>
          <div class="p-2 max-h-80 overflow-y-auto space-y-1 no-scrollbar">
            <button
              v-for="item in filteredHeadings"
              :key="item.id"
              class="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 transition"
              :class="
                item === activeHeading
                  ? 'bg-neutral-100 dark:bg-neutral-700'
                  : ''
              "
              :style="{ paddingLeft: `${8 + (item.level - 1) * 12}px` }"
              @click="goTo(item)"
            >
              <span class="text-[10px] w-4 text-right text-neutral-400"
                >H{{ item.level }}</span
              >
              <span class="truncate">{{ item.text }}</span>
            </button>
            <div
              v-if="!filteredHeadings.length"
              class="text-center text-sm text-neutral-400 py-4"
            >
              No headings found
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useTranslations } from '@/composable/useTranslations';

export default {
  props: { editor: Object },
  setup(props) {
    const { translations } = useTranslations();
    const headings = ref([]);
    const activeHeading = ref(null);
    const search = ref('');
    const showMenu = ref(false);
    const popoverStyle = ref({});
    const railRef = ref(null);
    const popoverRef = ref(null);
    const isTouchDevice = ref(false);
    const pillRefs = ref([]);

    const scrollContainer = ref(null);

    let hoverTimeout = null;
    let ticking = false;
    let positions = [];
    let removeEditorUpdate = null;
    let removeScrollListener = null;

    const visibleHeadings = computed(() => headings.value.slice(0, 500));

    const filteredHeadings = computed(() => {
      if (!search.value) return headings.value;
      const q = search.value.toLowerCase();
      return headings.value.filter((h) => h.text.toLowerCase().includes(q));
    });

    function setPillRef(i, el) {
      pillRefs.value[i] = el;
    }

    function findScrollContainer(el) {
      let node = el?.parentElement;
      while (
        node &&
        node !== document.body &&
        node !== document.documentElement
      ) {
        const ov = window.getComputedStyle(node).overflowY;
        if (ov === 'auto' || ov === 'scroll') return node;
        node = node.parentElement;
      }
      return window;
    }

    function getScrollInfo() {
      const c = scrollContainer.value;
      if (!c || c === window) {
        return { scrollY: window.scrollY, innerHeight: window.innerHeight };
      }
      return { scrollY: c.scrollTop, innerHeight: c.clientHeight };
    }

    function setupScrollListener() {
      if (removeScrollListener) {
        removeScrollListener();
        removeScrollListener = null;
      }
      const target = scrollContainer.value || window;
      target.addEventListener('scroll', onScroll, { passive: true });
      removeScrollListener = () => {
        target.removeEventListener('scroll', onScroll);
      };
    }

    function build() {
      const el = props.editor?.options?.element;
      if (!el) return;

      // Determine the scroll container from the editor's DOM position
      if (!scrollContainer.value) {
        scrollContainer.value = findScrollContainer(el);
        setupScrollListener();
      }

      headings.value = Array.from(el.querySelectorAll('h1,h2,h3,h4')).map(
        (node, i) => ({
          id: i,
          el: node,
          text: node.innerText.slice(0, 120),
          level: Number(node.tagName[1]),
        })
      );
      cache();
      update();
    }

    function cache() {
      const { scrollY } = getScrollInfo();
      positions = headings.value.map((h) => ({
        item: h,
        top: h.el.getBoundingClientRect().top + scrollY,
      }));
    }

    function update() {
      const { scrollY, innerHeight } = getScrollInfo();
      const cy = scrollY + innerHeight / 2;

      if (!positions.length) return;

      let found = positions[0].item;
      let closestDist = Math.abs(positions[0].top - cy);

      for (let i = 1; i < positions.length; i++) {
        const dist = Math.abs(positions[i].top - cy);
        if (dist < closestDist) {
          closestDist = dist;
          found = positions[i].item;
        }
      }

      if (activeHeading.value !== found) {
        activeHeading.value = found;
        nextTick(scrollTo);
      }
    }

    let animFrame = null;

    function animateTo(target) {
      const rail = railRef.value;
      if (!rail) return;

      if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }

      const start = rail.scrollTop;
      const diff = target - start;
      if (Math.abs(diff) < 3) {
        rail.scrollTop = target;
        return;
      }

      const startTime = performance.now();
      const duration = 350;

      function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const spring = 1 - Math.exp(-4.5 * t) * Math.cos(8 * t);
        rail.scrollTop = start + diff * spring;
        if (t < 1) animFrame = requestAnimationFrame(step);
        else rail.scrollTop = target;
      }

      animFrame = requestAnimationFrame(step);
    }

    function scrollTo() {
      if (!railRef.value || !activeHeading.value) return;
      const idx = visibleHeadings.value.indexOf(activeHeading.value);
      if (idx === -1) return;
      const pill = pillRefs.value[idx];
      if (!pill) return;
      const rail = railRef.value;
      const target = Math.round(
        pill.offsetTop + pill.offsetHeight / 2 - rail.clientHeight / 2
      );
      animateTo(
        Math.max(0, Math.min(target, rail.scrollHeight - rail.clientHeight))
      );
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    }

    function goTo(item) {
      item.el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showMenu.value = false;
      search.value = '';
    }

    function onEnter() {
      if (isTouchDevice.value) return;
      clearTimeout(hoverTimeout);
      showMenu.value = true;
      const r = railRef.value?.getBoundingClientRect();
      if (r) {
        popoverStyle.value = {
          top: `${r.top}px`,
          left: `${r.left - 12}px`,
          transform: 'translateX(-100%)',
        };
      }
    }

    function onLeave() {
      if (isTouchDevice.value) return;
      hoverTimeout = setTimeout(() => {
        showMenu.value = false;
        search.value = '';
      }, 200);
    }

    function onClickRail() {
      if (isTouchDevice.value) {
        showMenu.value = !showMenu.value;
      } else if (!showMenu.value) {
        showMenu.value = true;
      }

      if (showMenu.value) {
        const r = railRef.value?.getBoundingClientRect();
        if (r) {
          popoverStyle.value = {
            top: `${r.top}px`,
            left: `${r.left - 12}px`,
            transform: 'translateX(-100%)',
          };
        }
      } else {
        search.value = '';
      }
    }

    function onPillClick(item, event) {
      if (isTouchDevice.value) return;
      event.stopPropagation();
      goTo(item);
    }

    function onKeydown(e) {
      if (e.key === 'Escape' && showMenu.value) {
        showMenu.value = false;
        search.value = '';
      }
    }

    function onClickOutside(e) {
      if (!showMenu.value) return;
      if (
        !railRef.value?.contains(e.target) &&
        !popoverRef.value?.contains(e.target)
      ) {
        showMenu.value = false;
        search.value = '';
      }
    }

    function setupEditorListener() {
      if (removeEditorUpdate) {
        removeEditorUpdate();
        removeEditorUpdate = null;
      }
      if (props.editor) {
        const onUpdate = () => {
          requestAnimationFrame(build);
        };
        props.editor.on('update', onUpdate);
        removeEditorUpdate = () => {
          props.editor.off('update', onUpdate);
        };
      }
    }

    watch(
      () => props.editor,
      () => {
        requestAnimationFrame(build);
        setupEditorListener();
      },
      { immediate: true }
    );

    onMounted(() => {
      isTouchDevice.value =
        'ontouchstart' in window || navigator.maxTouchPoints > 0;
      // Fallback: attach to window initially (build() will switch to the real container)
      setupScrollListener();
      window.addEventListener('resize', cache);
      document.addEventListener('keydown', onKeydown);
      document.addEventListener('click', onClickOutside);
    });

    onUnmounted(() => {
      if (animFrame) cancelAnimationFrame(animFrame);
      clearTimeout(hoverTimeout);
      if (removeEditorUpdate) removeEditorUpdate();
      if (removeScrollListener) removeScrollListener();
      window.removeEventListener('resize', cache);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('click', onClickOutside);
    });

    return {
      translations,
      headings,
      activeHeading,
      visibleHeadings,
      filteredHeadings,
      search,
      showMenu,
      popoverStyle,
      railRef,
      popoverRef,
      setPillRef,
      goTo,
      onEnter,
      onLeave,
      onClickRail,
    };
  },
};
</script>
