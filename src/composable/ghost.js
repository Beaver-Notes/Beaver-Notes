const PEEK_OFFSET = 10;
const PEEK_ROT = 1.8;
const MAX_VISIBLE = 2;
const GHOST_SCALE = 0.98;

const debug = console.log.bind(console, '[ghost]');

function getPeekTransform(index) {
  if (index === 0) return { offset: 0, rot: 0, scale: GHOST_SCALE };
  const rot = index % 2 === 0 ? -PEEK_ROT : PEEK_ROT;
  const scale = 0.97;
  const offset = index * PEEK_OFFSET;
  return { offset, rot, scale };
}

function createGhostContainer(w, h) {
  const ghost = document.createElement('div');
  ghost.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: ${w}px;
    height: ${h}px;
    pointer-events: none;
    z-index: 2147483647;
    opacity: 1;
  `;
  return ghost;
}

function prepareClone(clone, original) {
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

  if (original) {
    const bg = getComputedStyle(original).backgroundColor;
    debug(
      'prepareClone bg:',
      bg,
      'original classes:',
      original.className?.slice(0, 120)
    );
    const alpha = parseFloat(bg?.match(/[\d.]+(?=\))/)?.[0] ?? '1');
    if (
      bg &&
      bg !== 'transparent' &&
      bg !== 'rgba(0, 0, 0, 0)' &&
      alpha >= 0.9
    ) {
      clone.style.backgroundColor = bg;
    }
  }

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
  Array.from(clone.classList).forEach((cls) => {
    if (/^bg-.+\/\d+$/.test(cls)) {
      clone.classList.remove(cls);
    }
  });

  clone.querySelectorAll('*').forEach((child) => {
    child.classList.remove(
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
  });

  return clone;
}

function composeTransform(originalTransform, scale, rotate = 0) {
  return rotate !== 0
    ? `rotate(${rotate}deg) scale(${scale})`
    : `scale(${scale})`;
}

function resolveCardElement(element, kind) {
  if (!element) {
    debug('resolveCardElement: null element', kind);
    return null;
  }
  const selector =
    kind === 'note' ? '[data-testid="note-card"]' : '.folder-card';
  const found = element.querySelector(selector);
  debug(
    'resolveCardElement',
    kind,
    'found:',
    !!found,
    'tag:',
    (found || element).tagName,
    'id:',
    (found || element).dataset?.itemId || (found || element).id || 'none'
  );
  return found || element;
}

export function createFullSizeCardGhost(element, count = 1, kind = 'note') {
  const card = resolveCardElement(element, kind);
  const rect = card.getBoundingClientRect();
  debug('createFullSizeCardGhost', {
    kind,
    count,
    rect: { w: rect.width, h: rect.height },
    cardTag: card.tagName,
    cardClasses: card.className?.slice(0, 100),
  });

  if (count === 1) {
    const ghost = createGhostContainer(rect.width, rect.height);
    const clone = prepareClone(card.cloneNode(true), card);
    clone.style.transform = composeTransform(null, GHOST_SCALE);
    ghost.appendChild(clone);
    document.body.appendChild(ghost);
    return ghost;
  }

  const visualCount = Math.min(count, MAX_VISIBLE);
  const extra = (visualCount - 1) * PEEK_OFFSET;
  const ghost = createGhostContainer(rect.width + extra, rect.height + extra);

  for (let i = visualCount - 1; i >= 0; i--) {
    const clone = prepareClone(card.cloneNode(true), card);
    const { offset, rot, scale } = getPeekTransform(i);
    clone.style.position = 'absolute';
    clone.style.top = `${offset}px`;
    clone.style.left = `${offset}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.transform = composeTransform(null, scale, rot);
    clone.style.transformOrigin = 'center center';
    clone.style.zIndex = String(1000 + (visualCount - i));
    ghost.appendChild(clone);
  }

  document.body.appendChild(ghost);
  return ghost;
}

export function createAnimatedStackGhost(elements, kind = 'note') {
  const cards = elements
    .map((el) => resolveCardElement(el, kind))
    .filter(Boolean);
  if (!cards.length) {
    cards.push(resolveCardElement(elements[0], kind));
  }
  const rect = cards[0].getBoundingClientRect();
  const count = cards.length;
  debug('createAnimatedStackGhost', {
    kind,
    elements: elements.length,
    cards: cards.length,
    rect: { w: rect.width, h: rect.height },
    firstCardClasses: cards[0]?.className?.slice(0, 100),
  });
  const visualCount = Math.min(count, MAX_VISIBLE);
  const extra = (visualCount - 1) * PEEK_OFFSET;
  const ghost = createGhostContainer(rect.width + extra, rect.height + extra);

  for (let i = visualCount - 1; i >= 0; i--) {
    const el = cards[i] || cards[0];
    const clone = prepareClone(el.cloneNode(true), el);
    const { offset, rot, scale } = getPeekTransform(i);
    clone.style.position = 'absolute';
    clone.style.top = `${offset}px`;
    clone.style.left = `${offset}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.transform = composeTransform(null, scale, rot);
    clone.style.transformOrigin = 'center center';
    clone.style.zIndex = String(1000 + (visualCount - i));
    ghost.appendChild(clone);
  }

  document.body.appendChild(ghost);
  return ghost;
}
