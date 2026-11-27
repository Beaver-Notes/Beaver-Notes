<template>
  <div class="note-headings-progress">
    <div
      v-if="visibleHeadings.length"
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
          <ui-input
            v-model="search"
            type="text"
            :placeholder="
              translations.noteActions?.searchHeadings || 'Search headings…'
            "
            radius="lg"
            class="w-full p-2 text-sm"
          />
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
              <span class="text-xs w-4 text-right text-neutral-400"
                >H{{ item.level }}</span
              >
              <span class="truncate">{{ item.text }}</span>
            </button>
            <div
              v-if="!filteredHeadings.length"
              class="text-center text-sm text-neutral-400 py-4"
            >
              {{ translations.noteActions?.noHeadingsFound || 'No headings found' }}
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
import { centerPosInView, scrollContainerOf } from '@/utils/ui/scroll';

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
    let removeEditorUpdate = null;
    let removeScrollListener = null;
    // Sorted by document position; drives both the active-pill lookup and the
    // jump targets. Model data — never invalidated by DOM re-rendering.
    let headingPositions = [];
    let buildTimer = 0;
    // Layout cache: rects and last midline, refreshed lazily so scrolling does
    // not force a full document layout on every frame.
    let lastRect = null;
    let lastCRect = null;
    let rectStamp = 0;
    const RECT_STALE_MS = 250;
    // Skip the hit-test unless the scroll position actually moved. The
    // scroller's bounding rect (and therefore the viewport midline) does not
    // change while scrolling inside it, so the guard must key on scrollTop,
    // not on rect geometry.
    let lastScrollY = -1;
    const SCROLL_DELTA_PX = 2;

    // Trailing debounce for rail rebuilds: one walk after edits settle
    // instead of one walk per keystroke during typing bursts.
    function scheduleBuild() {
      if (buildTimer) clearTimeout(buildTimer);
      buildTimer = setTimeout(() => {
        buildTimer = 0;
        if (!props.editor || props.editor.isDestroyed) return;
        build();
      }, 250);
    }

    const visibleHeadings = computed(() => headings.value.slice(0, 500));

    const filteredHeadings = computed(() => {
      if (!search.value) return headings.value;
      const q = search.value.toLowerCase();
      return headings.value.filter((h) => h.text.toLowerCase().includes(q));
    });

    function setPillRef(i, el) {
      pillRefs.value[i] = el;
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
      const ed = props.editor;
      const el = ed?.options?.element;
      if (!el) return;

      // Determine the scroll container from the editor's DOM position
      if (!scrollContainer.value) {
        scrollContainer.value = scrollContainerOf(el);
        setupScrollListener();
      }

      // Scan the DOCUMENT MODEL, not the DOM: reading rendered headings
      // (innerText) or measuring their rects would force layout of every
      // content-visibility block in a huge note. Model text is free, and
      // document positions survive DOM re-rendering.
      const found = [];
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          found.push({
            id: found.length,
            pos,
            text: node.textContent.slice(0, 120),
            level: node.attrs.level || 2,
          });
        }
        return true;
      });

      // Rebuild the reactive list only when the heading set actually changed
      // (typing body text neither adds headings nor moves them). Replacing
      // the array on every keystroke re-rendered up to 500 rail pills per
      // transaction — one of the "everything lags" sources on large notes.
      const prev = headings.value;
      let changed = prev.length !== found.length;
      if (!changed) {
        for (let i = 0; i < found.length; i += 1) {
          if (
            prev[i].pos !== found[i].pos ||
            prev[i].level !== found[i].level ||
            prev[i].text !== found[i].text
          ) {
            changed = true;
            break;
          }
        }
      }
      if (changed) {
        headings.value = found;
        headingPositions = found;
        update(true); // heading set changed — re-detect the active heading
      } else if (activeHeading.value === null) {
        update(true); // first build — set the initial active heading
      }
      // Unchanged and already have an active heading: skip layout reads.
    }

    function update(force) {
      const ed = props.editor;
      if (!ed || !headingPositions.length) return;

      const now = performance.now();
      // Cache rects to avoid forcing layout on every scroll frame. Refresh
      // on resize or when the cache goes stale.
      if (!lastRect || now - rectStamp > RECT_STALE_MS) {
        lastRect = ed.view.dom.getBoundingClientRect();
        lastCRect =
          scrollContainer.value !== window
            ? scrollContainer.value.getBoundingClientRect()
            : { top: 0, left: lastRect.left, height: window.innerHeight };
        rectStamp = now;
      }

      const midY = lastCRect.top + lastCRect.height / 2;
      // Skip posAtCoords (layout-forcing hit-test) unless the scroll position
      // moved enough to potentially change the active heading.
      const { scrollY } = getScrollInfo();
      if (!force && lastScrollY !== -1 && Math.abs(scrollY - lastScrollY) < SCROLL_DELTA_PX) return;
      lastScrollY = scrollY;

      // Anchor the hit-test x to the editor rect, not the scroller: the
      // scroller's left edge sits in the page gutter (left of the editable
      // content), where posAtCoords returns null and the active heading
      // would never resolve.
      const hitX = lastRect.left + Math.min(60, lastRect.width / 2);
      const coords = ed.view.posAtCoords({
        left: hitX,
        top: midY,
      });
      if (!coords) return;

      let lo = 0;
      let hi = headingPositions.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (headingPositions[mid].pos <= coords.pos) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      const found = idx >= 0 ? headingPositions[idx] : null;
      if (found && activeHeading.value !== found) {
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
        pill.offsetTop + pill.offsetHeight / 2 - rail.clientHeight / 2,
      );
      animateTo(
        Math.max(0, Math.min(target, rail.scrollHeight - rail.clientHeight)),
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
      const ed = props.editor;
      if (!ed || item.pos == null) return;
      showMenu.value = false;
      search.value = '';
      // Focus without letting ProseMirror auto-scroll; we center below.
      ed.commands.focus(undefined, { scrollIntoView: false });
      ed.commands.setTextSelection(item.pos);
      // The target block can be a placeholder whose real height is only
      // known after the glide starts, so re-measure it every frame.
      nextTick(() => {
        if (ed.isDestroyed) return;
        centerPosInView(ed, item.pos);
      });
    }

    function onEnter() {
      if (!headings.value.length || isTouchDevice.value) return;
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
      if (!headings.value.length) return;
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
        // Rebuild on updates, trailing-debounced: the model scan itself is
        // ~1-2ms, but per-keystroke rebuilds (during typing bursts or yjs
        // sync fills) kept the rail and its v-for hot on every transaction.
        // A trailing debounce still catches the yjs sync that fills content
        // right after open — the rail no longer stays empty for the session.
        const onUpdate = () => {
          scheduleBuild();
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
      { immediate: true },
    );

    onMounted(() => {
      isTouchDevice.value =
        'ontouchstart' in window || navigator.maxTouchPoints > 0;
      // Fallback: attach to window initially (build() will switch to the real container)
      setupScrollListener();
      window.addEventListener('resize', update);
      document.addEventListener('keydown', onKeydown);
      document.addEventListener('click', onClickOutside);
    });

    onUnmounted(() => {
      if (animFrame) cancelAnimationFrame(animFrame);
      clearTimeout(hoverTimeout);
      if (buildTimer) clearTimeout(buildTimer);
      if (removeEditorUpdate) removeEditorUpdate();
      if (removeScrollListener) removeScrollListener();
      window.removeEventListener('resize', update);
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
      onPillClick,
    };
  },
};
</script>
