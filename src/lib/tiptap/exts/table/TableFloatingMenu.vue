<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <Teleport :to="teleportTarget" v-if="teleportTarget">
    <div
      v-if="showMenu"
      ref="menuRef"
      class="absolute z-10"
      :style="menuStyle"
      @click.stop
    >
      <div
        class="bg-white dark:bg-neutral-800 rounded-xl shadow-xl border p-2"
        style="max-width: 18rem; min-width: 8rem"
      >
        <ui-list>
          <ui-list-item
            v-for="a in rows"
            :key="a.name"
            tag="button"
            small
            class="text-xs"
            :class="a.danger ? 'text-red-500' : ''"
            @click="run(a)"
          >
            <v-remixicon :name="a.icon" class="w-4 h-4 shrink-0" />
            <span>{{ a.label }}</span>
          </ui-list-item>
        </ui-list>

        <div
          class="border-t border-neutral-200 dark:border-neutral-700 my-1 mx-2"
        />

        <ui-list>
          <ui-list-item
            v-for="a in cols"
            :key="a.name"
            tag="button"
            small
            class="text-xs"
            :class="a.danger ? 'text-red-500' : ''"
            @click="run(a)"
          >
            <v-remixicon :name="a.icon" class="w-4 h-4 shrink-0" />
            <span>{{ a.label }}</span>
          </ui-list-item>
        </ui-list>

        <div
          class="border-t border-neutral-200 dark:border-neutral-700 my-1 mx-2"
        />

        <ui-list>
          <ui-list-item
            v-for="a in cells"
            :key="a.name"
            tag="button"
            small
            class="text-xs"
            :class="a.danger ? 'text-red-500' : ''"
            @click="run(a)"
          >
            <v-remixicon :name="a.icon" class="w-4 h-4 shrink-0" />
            <span>{{ a.label }}</span>
          </ui-list-item>
        </ui-list>

        <div
          class="border-t border-neutral-200 dark:border-neutral-700 my-1 mx-2"
        />

        <ui-list>
          <ui-list-item
            tag="button"
            small
            class="text-xs text-red-500"
            @click="del"
          >
            <v-remixicon name="riDeleteBin6Line" class="w-4 h-4 shrink-0" />
            <span>{{ t?.menu?.deleteTable || 'Delete table' }}</span>
          </ui-list-item>
        </ui-list>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getTranslations } from '@/utils/getTranslations';

export default {
  props: { editor: { type: Object, default: null } },
  setup(props) {
    const t = getTranslations();

    const showMenu = ref(false);
    const menuStyle = ref({});
    const menuRef = ref(null);
    const teleportTarget = ref(null);

    let triggerEl = null;

    const rows = computed(() => [
      {
        name: 'addRowAbove',
        label: t?.menu?.addRowAbove || 'Add row above',
        icon: 'riInsertRowTop',
        run: () => props.editor?.chain().focus().addRowBefore().run(),
      },
      {
        name: 'addRowBelow',
        label: t?.menu?.addRowBelow || 'Add row below',
        icon: 'riInsertRowBottom',
        run: () => props.editor?.chain().focus().addRowAfter().run(),
      },
      {
        name: 'deleteRow',
        label: t?.menu?.deleteRow || 'Delete row',
        icon: 'riDeleteRow',
        danger: true,
        run: () => props.editor?.chain().focus().deleteRow().run(),
      },
    ]);
    const cols = computed(() => [
      {
        name: 'addColumnLeft',
        label: t?.menu?.addColumnLeft || 'Add column left',
        icon: 'riInsertColumnLeft',
        run: () => props.editor?.chain().focus().addColumnBefore().run(),
      },
      {
        name: 'addColumnRight',
        label: t?.menu?.addColumnRight || 'Add column right',
        icon: 'riInsertColumnRight',
        run: () => props.editor?.chain().focus().addColumnAfter().run(),
      },
      {
        name: 'deleteColumn',
        label: t?.menu?.deleteColumn || 'Delete column',
        icon: 'riDeleteColumn',
        danger: true,
        run: () => props.editor?.chain().focus().deleteColumn().run(),
      },
    ]);
    const cells = computed(() => [
      {
        name: 'mergeOrSplit',
        label: t?.menu?.mergeOrSplit || 'Merge / Split cells',
        icon: 'riSplitCellsHorizontal',
        run: () => props.editor?.chain().focus().mergeOrSplit().run(),
      },
      {
        name: 'toggleHeader',
        label: t?.menu?.toggleHeader || 'Toggle header',
        icon: 'riBrush2Fill',
        run: () => props.editor?.chain().focus().toggleHeaderCell().run(),
      },
    ]);


    function getActiveCell() {
      if (!props.editor) return null;
      try {
        const { from } = props.editor.state.selection;
        const r = props.editor.view.domAtPos(from);
        let el = r.node;
        if (el instanceof Text) el = el.parentElement;
        return el?.closest?.('td, th') || null;
      } catch {
        return null;
      }
    }

    function getTableWrapper() {
      if (!props.editor) return null;
      const cell = getActiveCell();
      if (!cell) return null;
      return cell.closest('.tableWrapper');
    }

    function updateTeleportTarget() {
      teleportTarget.value = getTableWrapper();
    }

    function isInCell() {
      return !!(
        props.editor &&
        (props.editor.isActive('tableCell') ||
          props.editor.isActive('tableHeader'))
      );
    }


    function removeTrigger() {
      if (triggerEl && triggerEl.parentNode) {
        triggerEl.parentNode.removeChild(triggerEl);
      }
      triggerEl = null;
    }

    function injectTrigger() {
      removeTrigger();

      const wrapper = getTableWrapper();
      const cell = getActiveCell();
      if (!wrapper || !cell) return;

      const wr = wrapper.getBoundingClientRect();
      const cr = cell.getBoundingClientRect();

      const btn = document.createElement('button');
      btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 16L6 10H18L12 16Z"></path></svg>';
      btn.setAttribute('aria-label', 'Table options');

      updateTeleportTarget();

      btn.className =
        'absolute flex items-center justify-center w-5 h-5 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 border rounded shadow-sm cursor-pointer z-10 ' +
        'text-neutral-400 dark:text-neutral-500 ' +
        'pointer-events-auto opacity-85 hover:opacity-100 hover:text-primary transition-all duration-100';
      btn.style.top = `${cr.top - wr.top + 4}px`;
      btn.style.left = `${cr.right - wr.left - 24}px`;

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu(cell);
      });

      wrapper.appendChild(btn);
      triggerEl = btn;
    }


    function toggleMenu(cell) {
      if (showMenu.value) {
        closeMenu();
      } else {
        openMenu(cell);
      }
    }

    function openMenu(cell) {
      if (!cell) cell = getActiveCell();
      if (!cell) return;
      const wrapper = getTableWrapper();
      if (!wrapper) return;
      const wr = wrapper.getBoundingClientRect();
      const br = triggerEl?.getBoundingClientRect();
      if (!br) return;
      menuStyle.value = {
        top: `${br.bottom - wr.top + 4}px`,
        right: `${wr.right - br.right}px`,
      };
      showMenu.value = true;
    }

    function closeMenu() {
      showMenu.value = false;
    }

    function run(a) {
      a.run();
      closeMenu();
      props.editor?.commands?.focus();
    }
    function del() {
      props.editor?.chain().focus().deleteTable().run();
      closeMenu();
    }

    function onClick(e) {
      if (!showMenu.value) return;
      if (menuRef.value && menuRef.value.contains(e.target)) return;
      if (triggerEl && triggerEl.contains(e.target)) return;
      closeMenu();
    }

    function onKey(e) {
      if (e.key === 'Escape' && showMenu.value) closeMenu();
    }


    let wasIn = false;

    function onSel() {
      const now = isInCell();
      if (now && !wasIn) {
        injectTrigger();
      } else if (now && wasIn) {
        injectTrigger();
      } else if (!now && wasIn) {
        removeTrigger();
        closeMenu();
      }
      wasIn = now;
    }


    onMounted(() => {
      if (!props.editor) return;
      props.editor.on('selectionUpdate', onSel);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey);
    });

    onUnmounted(() => {
      if (props.editor) props.editor.off('selectionUpdate', onSel);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
      removeTrigger();
    });

    return {
      showMenu,
      menuStyle,
      menuRef,
      teleportTarget,
      t,
      rows,
      cols,
      cells,
      run,
      del,
    };
  },
};
</script>

<style scoped>
.absolute {
  pointer-events: auto;
}
</style>
