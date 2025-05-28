import { getCurrentInstance, onMounted, onUnmounted, shallowRef } from 'vue';
import { createSingleton } from 'tippy.js';
import createTippy, { defaultOptions } from '@/lib/tippy';

class ZoomHandler {
  constructor() {
    this.currentZoom = 1;
    this.observers = new Set();
    this.init();
  }

  init() {
    this.detectZoom();
    this.setupZoomListener();
  }

  detectZoom() {
    const bodyStyle = window.getComputedStyle(document.body);
    let zoom = parseFloat(bodyStyle.zoom) || 1;

    if (zoom === 1 && bodyStyle.transform && bodyStyle.transform !== 'none') {
      const match = bodyStyle.transform.match(/scale\(([^)]+)\)/);
      if (match) {
        zoom = parseFloat(match[1]);
      }
    }

    if (window.electronAPI?.getZoomLevel) {
      zoom = window.electronAPI.getZoomLevel();
    }

    this.currentZoom = zoom;
    return zoom;
  }

  setupZoomListener() {
    const observer = new MutationObserver(() => {
      const newZoom = this.detectZoom();
      if (newZoom !== this.currentZoom) {
        this.currentZoom = newZoom;
        this.notifyObservers(newZoom);
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style'],
    });

    window.addEventListener('resize', () => {
      setTimeout(() => {
        const newZoom = this.detectZoom();
        if (newZoom !== this.currentZoom) {
          this.currentZoom = newZoom;
          this.notifyObservers(newZoom);
        }
      }, 100);
    });
  }

  addObserver(callback) {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  notifyObservers(zoom) {
    this.observers.forEach((callback) => callback(zoom));
  }

  getZoom() {
    return this.currentZoom;
  }
}

const zoomHandler = new ZoomHandler();

function createZoomAwareTippyOptions(baseOptions = {}) {
  const zoom = zoomHandler.getZoom();

  return {
    ...defaultOptions,
    ...baseOptions,

    popperOptions: {
      modifiers: [
        {
          name: 'zoomFix',
          enabled: true,
          phase: 'afterWrite',
          fn({ state }) {
            const zoom = zoomHandler.getZoom();
            if (zoom !== 1) {
              const popper = state.elements.popper;
              const reference = state.elements.reference;

              const refRect = reference.getBoundingClientRect();

              const popperHeight = popper.offsetHeight / zoom;
              const popperWidth = popper.offsetWidth / zoom;

              const placement = state.placement;
              let targetX, targetY;

              switch (placement) {
                case 'right':
                case 'right-start':
                case 'right-end':
                  targetX = refRect.right / zoom + 8 / zoom;
                  targetY =
                    placement === 'right-start'
                      ? refRect.top / zoom
                      : placement === 'right-end'
                      ? refRect.bottom / zoom - popperHeight
                      : refRect.top / zoom +
                        refRect.height / zoom / 2 -
                        popperHeight / 2;
                  break;

                case 'left':
                case 'left-start':
                case 'left-end':
                  targetX = refRect.left / zoom - popperWidth - 8 / zoom;
                  targetY =
                    placement === 'left-start'
                      ? refRect.top / zoom
                      : placement === 'left-end'
                      ? refRect.bottom / zoom - popperHeight
                      : refRect.top / zoom +
                        refRect.height / zoom / 2 -
                        popperHeight / 2;
                  break;

                case 'top':
                case 'top-start':
                case 'top-end':
                  targetX =
                    placement === 'top-start'
                      ? refRect.left / zoom
                      : placement === 'top-end'
                      ? refRect.right / zoom - popperWidth
                      : refRect.left / zoom +
                        refRect.width / zoom / 2 -
                        popperWidth / 2;
                  targetY = refRect.top / zoom - popperHeight - 8 / zoom;
                  break;

                case 'bottom':
                case 'bottom-start':
                case 'bottom-end':
                  targetX =
                    placement === 'bottom-start'
                      ? refRect.left / zoom
                      : placement === 'bottom-end'
                      ? refRect.right / zoom - popperWidth
                      : refRect.left / zoom +
                        refRect.width / zoom / 2 -
                        popperWidth / 2;
                  targetY = refRect.bottom / zoom + 8 / zoom;
                  break;

                default:
                  targetX = refRect.right / zoom + 8 / zoom;
                  targetY =
                    refRect.top / zoom +
                    refRect.height / zoom / 2 -
                    popperHeight / 2;
              }

              popper.style.transform = `translate(${Math.round(
                targetX
              )}px, ${Math.round(targetY)}px)`;
              popper.style.position = 'fixed';
            }
          },
        },
      ],
    },

    offset: [0, (baseOptions.offset?.[1] || 8) / zoom],
  };
}

export function useGroupTooltip(elements, options = {}) {
  const singleton = shallowRef(null);
  let cleanupZoomListener = null;

  onMounted(() => {
    let tippyInstances = [];

    if (Array.isArray(elements)) {
      tippyInstances = elements.map((el) => el._tippy || createTippy(el));
    } else {
      const ctx = getCurrentInstance() && getCurrentInstance().ctx;
      tippyInstances = ctx._tooltipGroup || [];
    }

    const zoomAwareOptions = createZoomAwareTippyOptions({
      ...options,
      theme: 'tooltip-theme',
      placement: 'right',
      moveTransition: 'transform 0.2s ease-out',
      overrides: ['placement', 'theme'],
    });

    singleton.value = createSingleton(tippyInstances, zoomAwareOptions);

    cleanupZoomListener = zoomHandler.addObserver(() => {
      if (singleton.value) {
        singleton.value.setProps(
          createZoomAwareTippyOptions({
            ...options,
            theme: 'tooltip-theme',
            placement: 'right',
            moveTransition: 'transform 0.2s ease-out',
            overrides: ['placement', 'theme'],
          })
        );

        singleton.value.popperInstance?.update();
      }
    });
  });

  onUnmounted(() => {
    if (cleanupZoomListener) {
      cleanupZoomListener();
    }
  });

  return singleton;
}

export function useZoom() {
  return {
    getZoom: () => zoomHandler.getZoom(),
    onZoomChange: (callback) => zoomHandler.addObserver(callback),
  };
}
