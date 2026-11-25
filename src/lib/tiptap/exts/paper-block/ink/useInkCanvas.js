/**
 * useInkCanvas.js — per-surface canvas wiring (REDESIGN phase A).
 *
 * `setup(container, drawing, opts)` → InkCanvas with `.destroy()`.
 * `fitCanvas(ink, rect, dpr)` exported for direct use in tests.
 */

import { InkCanvas } from './inkCanvas.js';

export function fitCanvas(ink, rect, dpr) {
  ink.changeDrawing({ rect, dpr });
}

export function setup(container, drawing, opts = {}) {
  const dpr = opts.dpr != null ? opts.dpr : (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const ink = new InkCanvas(opts);

  // hidden sentinel div inside the container (keeps the container non-empty for layout)
  const sentinel = document.createElement('div');
  sentinel.style.position = 'absolute';
  sentinel.style.inset = '0';
  sentinel.style.pointerEvents = 'none';
  sentinel.style.opacity = '0';
  sentinel.setAttribute('aria-hidden', 'true');
  container.appendChild(sentinel);

  ink.attach(drawing, null, null);
  fitCanvas(ink, { width: container.clientWidth || 0, height: container.clientHeight || 0 }, dpr);

  let raf = 0;
  let initial = true;
  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          const rect = {
            width: container.clientWidth || 0,
            height: container.clientHeight || 0,
          };
          // initial 0×0 fire ignored
          if (initial && rect.width === 0 && rect.height === 0) {
            initial = false;
            return;
          }
          initial = false;
          if (raf) cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            raf = 0;
            fitCanvas(ink, rect, dpr);
          });
        })
      : null;
  if (ro) ro.observe(container);

  function destroy() {
    if (ro) ro.disconnect();
    if (raf) cancelAnimationFrame(raf);
    if (sentinel.parentNode === container) container.removeChild(sentinel);
  }

  ink.destroy = destroy;
  return ink;
}
