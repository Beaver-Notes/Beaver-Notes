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

function resetCloneStyles(clone) {
  clone.style.position = 'absolute';
  clone.style.top = '0';
  clone.style.left = '0';
  clone.style.width = '100%';
  clone.style.height = '100%';
  clone.style.margin = '0';
  clone.style.transition = 'none';
  clone.style.opacity = '1';
  clone.style.transformOrigin = 'center center';

  clone.classList.remove('opacity-50', 'rotate-1', 'rotate-2', 'transform');

  if (clone.style.opacity !== '1') {
    clone.style.setProperty('opacity', '1', 'important');
  }

  return clone;
}

export function createFullSizeCardGhost(element, count = 1) {
  const ghost = document.createElement('div');
  const rect = element.getBoundingClientRect();

  Object.assign(ghost.style, {
    position: 'absolute',
    top: '-9999px',
    left: '-9999px',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: 'none',
    zIndex: '9999',
    transformOrigin: 'center center',
    opacity: '1',
  });

  if (count === 1) {
    const clone = resetCloneStyles(element.cloneNode(true));
    clone.style.position = 'relative';
    clone.style.transform = 'scale(0.98)';
    ghost.appendChild(clone);
  } else {
    for (let i = count - 1; i >= 0; i--) {
      const stackCard = resetCloneStyles(element.cloneNode(true));
      const { rot, scale } = getCenteredOppositeTilt(i);

      stackCard.style.transform = `rotate(${rot}deg) scale(${scale})`;
      stackCard.style.zIndex = String(1000 + (count - i));
      ghost.appendChild(stackCard);
    }

    const topCard = ghost.lastElementChild;
    if (topCard && count > 1) {
      const badge = document.createElement('div');
      Object.assign(badge.style, {
        position: 'absolute',
        top: '8px',
        right: '8px',
        backgroundColor: '#3b82f6',
        color: 'white',
        borderRadius: '50%',
        width: '24px',
        height: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: 'bold',
        border: '2px solid white',
        opacity: '1',
        zIndex: '10',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      });
      badge.textContent = count;
      topCard.style.position = 'relative';
      topCard.appendChild(badge);
    }
  }

  document.body.appendChild(ghost);
  return ghost;
}

export function createAnimatedStackGhost(elements) {
  const container = document.createElement('div');
  const rect = elements[0].getBoundingClientRect();

  Object.assign(container.style, {
    position: 'absolute',
    top: '-9999px',
    left: '-9999px',
    pointerEvents: 'none',
    zIndex: '9999',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    opacity: '1',
  });

  elements.forEach((element, index) => {
    const clone = resetCloneStyles(element.cloneNode(true));
    const delay = index * 50;

    clone.style.transform = `rotate(${Math.min(index * 3, 8)}deg) scale(0.9)`;
    clone.style.zIndex = String(1000 + (elements.length - index));
    container.appendChild(clone);

    setTimeout(() => {
      const { rot, scale } = getCenteredOppositeTilt(index);
      clone.style.transition = 'transform 0.2s ease-out';
      clone.style.transform = `rotate(${rot}deg) scale(${scale})`;
    }, delay);
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
      'opacity-100',
      'z-[10000]',
      'bg-primary',
      'text-white',
      'border-white',
      'shadow-md',
    ].join(' ');
    badge.textContent = elements.length;
    container.appendChild(badge);
  }

  document.body.appendChild(container);
  return container;
}
