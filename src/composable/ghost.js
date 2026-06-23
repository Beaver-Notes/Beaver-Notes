const STACK_ROT_STEP = 0.9;
const STACK_ROT_MAX = 4;
const STACK_SCALE_MIN = 0.9;

function getCenteredOppositeTilt(index) {
  if (index === 0) {
    return { rot: 0, scale: 0.98 };
  }
  const rot = Math.min(index * STACK_ROT_STEP, STACK_ROT_MAX);
  const scale = Math.max(0.98 - index * 0.01, STACK_SCALE_MIN);
  return { rot, scale };
}

/**
 * Creates a container for the drag ghost, positioned in the viewport
 * so the browser can render it for setDragImage.
 */
function createGhostContainer(rect) {
  const ghost = document.createElement('div');
  ghost.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: ${rect.width}px;
    height: ${rect.height}px;
    pointer-events: none;
    z-index: 2147483647;
    opacity: 1;
  `;
  return ghost;
}

/**
 * Prepares a cloned card element for use as a drag image.
 * Clears the masonry positioning transform since the ghost container
 * already handles placement — the clone should render naturally inside it.
 */
function prepareClone(clone) {
  clone.style.transform = '';
  clone.style.position = 'relative';
  clone.style.top = '0';
  clone.style.left = '0';
  clone.style.width = '100%';
  clone.style.height = '100%';
  clone.style.margin = '0';
  clone.style.transition = 'none';
  clone.style.animation = 'none';
  clone.style.opacity = '1';
  clone.style.contain = 'none';
  clone.style.transformOrigin = 'center center';
  clone.style.contentVisibility = 'visible';
  clone.style.containIntrinsicSize = 'none';
  clone.style.willChange = 'auto';

  clone.querySelectorAll('*').forEach((child) => {
    child.style.contain = 'none';
    child.style.contentVisibility = 'visible';
    child.style.willChange = 'auto';
  });

  clone.classList.remove(
    'opacity-50',
    'opacity-60',
    'opacity-70',
    'opacity-80',
    'opacity-90',
    'rotate-1',
    'rotate-2',
    'rotate-3',
    'rotate-6'
  );

  return clone;
}

/**
 * Helper: Applies scale/rotate transforms for the ghost stack effect.
 * The original masonry translate3d is never preserved — it's irrelevant
 * for the floating drag ghost.
 */
function composeTransform(originalTransform, scale, rotate = 0) {
  return rotate !== 0
    ? `rotate(${rotate}deg) scale(${scale})`
    : `scale(${scale})`;
}

/**
 * Simple count-badge ghost for multi-select drags.
 * No DOM cloning — just a clean card with a count badge.
 */
export function createCountBadgeGhost(count, templateElement) {
  const rect = templateElement
    ? templateElement.getBoundingClientRect()
    : { width: 200, height: 140 };
  const ghost = document.createElement('div');

  ghost.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: ${rect.width}px;
    height: ${rect.height}px;
    pointer-events: none;
    z-index: 2147483647;
    background: #ffffff;
    border-radius: 12px;
    border: 1.5px solid rgba(0,0,0,0.15);
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const badge = document.createElement('div');
  badge.style.cssText = `
    background: #3b82f6;
    color: white;
    border-radius: 50%;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: bold;
    font-family: system-ui, sans-serif;
  `;
  badge.textContent = count;

  ghost.appendChild(badge);
  document.body.appendChild(ghost);
  return ghost;
}

export function createFullSizeCardGhost(element, count = 1) {
  const rect = element.getBoundingClientRect();
  const ghost = createGhostContainer(rect);

  if (count === 1) {
    const clone = prepareClone(element.cloneNode(true));
    clone.style.transform = composeTransform(null, 0.98);
    ghost.appendChild(clone);
  } else {
    for (let i = count - 1; i >= 0; i--) {
      const stackCard = prepareClone(element.cloneNode(true));
      const { rot, scale } = getCenteredOppositeTilt(i);
      stackCard.style.transform = composeTransform(null, scale, rot);
      stackCard.style.zIndex = String(1000 + (count - i));
      ghost.appendChild(stackCard);
    }

    const topCard = ghost.lastElementChild;
    if (topCard && count > 1) {
      const badge = document.createElement('div');
      badge.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background-color: #3b82f6;
        color: white;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        border: 2px solid white;
        opacity: 1;
        z-index: 10;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      `;
      badge.textContent = count;
      topCard.style.position = 'relative';
      topCard.appendChild(badge);
    }
  }

  document.body.appendChild(ghost);
  return ghost;
}

export function createAnimatedStackGhost(elements) {
  const rect = elements[0].getBoundingClientRect();
  const container = createGhostContainer(rect);

  elements.forEach((element, index) => {
    const clone = prepareClone(element.cloneNode(true));
    const { rot, scale } = getCenteredOppositeTilt(index);

    clone.style.transform = composeTransform(null, scale, rot);
    clone.style.zIndex = String(1000 + (elements.length - index));
    container.appendChild(clone);
  });

  if (elements.length > 1) {
    const badge = document.createElement('div');
    badge.className = [
      'absolute',
      'top-4',
      'right-6',
      'rounded-full',
      'size-6',
      'flex',
      'items-center',
      'justify-center',
      'text-[12px]',
      'font-bold',
      'border-2',
      'bg-primary',
      'text-white',
      'border-white',
      'shadow-md',
    ].join(' ');
    badge.style.opacity = '1';
    badge.style.zIndex = '10000';
    badge.textContent = elements.length;
    container.appendChild(badge);
  }

  document.body.appendChild(container);
  return container;
}
