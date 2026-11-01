/**
 * Publishes a fold layout on a document root. Pure DOM: no Tauri, no store.
 * Components read the variables, never the plugin.
 */
export function applyFoldLayout(layout, root = document.documentElement) {
  const crease = layout?.crease;
  root.classList.toggle('runtime-foldable', layout?.source !== 'none');
  // Folded = a crease is actively splitting the view (flat inner display
  // reports none; the fallback crease at width/2 counts as folded).
  root.classList.toggle(
    'runtime-folded',
    !!layout && layout.orientation !== 'none'
  );
  root.style.setProperty('--fold-segment-width', `${layout?.segmentWidth ?? 0}px`);
  root.style.setProperty('--fold-crease-left', `${crease?.left ?? 0}px`);
  root.style.setProperty('--fold-crease-width', `${crease?.width ?? 0}px`);
  root.style.setProperty('--fold-orientation', layout?.orientation ?? 'none');
}
