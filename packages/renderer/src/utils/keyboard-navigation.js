class EventHandler {
  constructor({ breakpoints }) {
    this.breakpoints = breakpoints;
    this.keydownHandler = this._keydownHandler.bind(this);
  }

  activeItemIndex() {
    return this.items.indexOf(this.activeItem);
  }

  getBreakpoint() {
    let breakpoint = this.breakpoints?.default || 1;

    Object.keys(this.breakpoints || {}).forEach((mediaQuery) => {
      if (window.matchMedia(mediaQuery).matches)
        breakpoint = this.breakpoints[mediaQuery];
    });

    return breakpoint;
  }

  _keydownHandler(event) {
    const keyHandlers = {
      ArrowUp: this.upHandler.bind(this),
      ArrowDown: this.downHandler.bind(this),
      ArrowLeft: this.leftHandler.bind(this),
      ArrowRight: this.rightHandler.bind(this),
    };
    const elementBlacklist = ['INPUT', 'SELECT', 'TEXTAREA'];
    const isInBlacklist = elementBlacklist.includes(event.target.tagName);

    if (keyHandlers[event.key] && !isInBlacklist) {
      event.preventDefault();

      this.activeItem?.classList.remove(...this.activeClass);
      keyHandlers[event.key]();
      this.activeItem?.classList.add(...this.activeClass);
      this.activeItem?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (event.key === 'Enter') {
      this._fireEvent('select', this.activeItem);
    }

    this._fireEvent('keydown', { event, activeItem: this.activeItem });
  }

  upHandler() {
    const brekpoint = this.getBreakpoint();
    const prevIndex = this.activeItemIndex() - brekpoint;

    if (prevIndex < 0) this.activeItem = this.items[this.items.length - 1];
    else this.activeItem = this.items[prevIndex];
  }

  downHandler() {
    const brekpoint = this.getBreakpoint();
    const nextIndex = this.activeItemIndex() + brekpoint;

    if (nextIndex > this.items.length - 1) this.activeItem = this.items[0];
    else this.activeItem = this.items[nextIndex];
  }

  leftHandler() {
    const index = this.activeItemIndex();
    const prevItem = this.items[index - 1];

    if (prevItem) this.activeItem = prevItem;
    else if (index <= 0) this.activeItem = this.items[this.items.length - 1];
  }

  rightHandler() {
    const index = this.activeItemIndex();
    const nextItem = this.items[index + 1];

    if (nextItem) this.activeItem = nextItem;
    else if (index + 1 > this.items.length - 1) this.activeItem = this.items[0];
  }
}

class KeyboardNavigation extends EventHandler {
  constructor({
    container = document,
    itemSelector = '',
    activeClass = 'is-active',
    breakpoints,
  }) {
    super({ container, breakpoints });

    this.itemSelector = itemSelector;
    this.activeClass = activeClass.split(' ');
    this.container =
      typeof container === 'string'
        ? document.querySelector(container)
        : container;
    this.activeItem = null;
    this.items = [];
    this.listeners = {};

    this._retrieveItems();
    window.addEventListener('keydown', this.keydownHandler);
  }

  on(name, callback) {
    (this.listeners[name] = this.listeners[name] || []).push(callback);
  }

  refresh() {
    this._retrieveItems();
    this.activeItem?.classList.remove(...this.activeClass);
    this.activeItem = null;
  }

  destroy() {
    window.removeEventListener('keydown', this.keydownHandler);

    this.listeners = {};
    this.activeItem?.classList.remove(...this.activeClass);
  }

  _retrieveItems() {
    this.items = [...this.container.querySelectorAll(this.itemSelector)];
  }

  _fireEvent(name, params) {
    (this.listeners[name] || []).forEach((callback) => {
      callback(params);
    });
  }
}

export default KeyboardNavigation;
