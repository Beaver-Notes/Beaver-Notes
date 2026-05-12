import { backend } from '@/lib/tauri-bridge';
import { computePosition, autoUpdate, offset, flip, shift } from '@floating-ui/dom';

function parseContent(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && value.content) return value.content;
  return '';
}

export default {
  mounted(el, { value, arg = 'top', instance, modifiers }) {
    if (backend.isMobileRuntime()) return;

    if (modifiers.group) {
      if (!Array.isArray(instance._tooltipGroup)) instance._tooltipGroup = [];
      instance._tooltipGroup.push({ el, content: parseContent(value), placement: arg });
      return;
    }

    const tooltipEl = document.createElement('div');
    tooltipEl.className = 'floating-tooltip';
    tooltipEl.textContent = parseContent(value);
    Object.assign(tooltipEl.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '9999',
    });
    document.body.appendChild(tooltipEl);

    let cleanupAutoUpdate = null;

    const updatePosition = () => {
      if (cleanupAutoUpdate) cleanupAutoUpdate();
      cleanupAutoUpdate = autoUpdate(el, tooltipEl, () => {
        computePosition(el, tooltipEl, {
          placement: arg,
          strategy: 'fixed',
          middleware: [offset(8), flip(), shift({ padding: 5 })],
        }).then(({ x, y }) => {
          tooltipEl.style.transform = `translate(${x}px, ${y}px)`;
        });
      });
    };

    const show = () => {
      tooltipEl.style.display = '';
      updatePosition();
    };

    const hide = () => {
      if (cleanupAutoUpdate) {
        cleanupAutoUpdate();
        cleanupAutoUpdate = null;
      }
      tooltipEl.style.display = 'none';
    };

    el.addEventListener('mouseenter', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', show);
    el.addEventListener('blur', hide);

    el._floatingTooltip = {
      destroy: () => {
        hide();
        tooltipEl.remove();
        el.removeEventListener('mouseenter', show);
        el.removeEventListener('mouseleave', hide);
        el.removeEventListener('focus', show);
        el.removeEventListener('blur', hide);
      },
      setContent: (text) => { tooltipEl.textContent = text; },
    };
  },
  updated(el, { value, arg = 'top' }) {
    if (el._floatingTooltip) {
      el._floatingTooltip.setContent(parseContent(value));
    }
  },
  unmounted(el) {
    if (el._floatingTooltip) {
      el._floatingTooltip.destroy();
    }
  },
};
