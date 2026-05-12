import { getCurrentInstance, onMounted, onUnmounted, shallowRef } from 'vue';
import { backend } from '@/lib/tauri-bridge';
import { computePosition, autoUpdate, offset, flip, shift } from '@floating-ui/dom';

export function useGroupTooltip(elements, options = {}) {
  const tooltipEl = shallowRef(null);
  let cleanup = null;
  const groupEntries = [];

  function showTooltip(entry) {
    hideTooltip();
    const tip = tooltipEl.value;
    if (!tip) return;
    tip.textContent = entry.content || '';
    tip.style.display = '';

    cleanup = autoUpdate(entry.el, tip, () => {
      computePosition(entry.el, tip, {
        placement: entry.placement || 'right',
        strategy: 'fixed',
        middleware: [offset(8), flip(), shift({ padding: 5 })],
      }).then(({ x, y }) => {
        tip.style.transform = `translate(${x}px, ${y}px)`;
      });
    });
  }

  function hideTooltip() {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    if (tooltipEl.value) {
      tooltipEl.value.style.display = 'none';
    }
  }

  onMounted(() => {
    if (backend.isMobileRuntime()) return;

    const tip = document.createElement('div');
    tip.className = 'floating-tooltip';
    Object.assign(tip.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '9999',
    });
    document.body.appendChild(tip);
    tooltipEl.value = tip;

    let entries;
    if (Array.isArray(elements)) {
      entries = elements.map((el) => ({
        el,
        content: options.content || '',
        placement: options.placement || 'right',
      }));
    } else {
      const ctx = getCurrentInstance()?.ctx;
      entries = ctx?._tooltipGroup || [];
    }

    entries.forEach((entry) => {
      const onEnter = () => showTooltip(entry);
      const onLeave = hideTooltip;
      entry.el.addEventListener('mouseenter', onEnter);
      entry.el.addEventListener('mouseleave', onLeave);
      entry.el.addEventListener('focus', onEnter);
      entry.el.addEventListener('blur', onLeave);
      groupEntries.push({ ...entry, onEnter, onLeave });
    });
  });

  onUnmounted(() => {
    hideTooltip();
    groupEntries.forEach(({ el, onEnter, onLeave }) => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('focus', onEnter);
      el.removeEventListener('blur', onLeave);
    });
    tooltipEl.value?.remove();
  });

  return tooltipEl;
}
