import Image from '@tiptap/extension-image';
import { Plugin, PluginKey } from 'prosemirror-state';
import { useStore } from '@/store';
import copyImage from '@/utils/copy-image';
import { writeImageFile } from '@/utils/copy-image';

const HANDLE_SIDES = ['left', 'right'];

function clampWidth(width, limits = {}) {
  const minWidth = Number.isFinite(limits.minWidth) ? limits.minWidth : 96;
  const maxWidth = Number.isFinite(limits.maxWidth) ? limits.maxWidth : null;

  let clampedWidth = Math.max(minWidth, width);

  if (maxWidth !== null) {
    clampedWidth = Math.min(clampedWidth, maxWidth);
  }

  return clampedWidth;
}

function getDefaultContainerStyle(inline, width) {
  const baseStyle = `width: ${width || '100%'}; height: auto;`;
  const inlineStyle = inline ? 'display: inline-block;' : '';
  return `${baseStyle} ${inlineStyle}`.trim();
}

function getDefaultWrapperStyle(inline) {
  return inline ? 'display: inline-block;' : 'display: block;';
}

function extractWidthFromStyle(style = '') {
  const width = style.match(/width:\s*([0-9.]+)px/);
  return width ? Number(width[1]) : null;
}

function getLayoutModeFromWrapperStyle(style = '') {
  if (style.includes('float: left')) return 'wrap-left';
  if (style.includes('float: right')) return 'wrap-right';

  return 'block';
}

function applyImageAttributes(nodeAttrs, imgElement) {
  Object.entries(nodeAttrs).forEach(([key, value]) => {
    if (key === 'containerStyle' || key === 'wrapperStyle') return;

    if (value === undefined || value === null) {
      imgElement.removeAttribute(key);
      return;
    }

    if (key === 'width') {
      imgElement.setAttribute('width', String(value));
      return;
    }

    imgElement.setAttribute(key, value);
  });
}

class ImageNodeView {
  constructor({ node, editor, getPos, inline, resizeLimits }) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;
    this.inline = inline;
    this.resizeLimits = resizeLimits;
    this.resizeState = null;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'bn-image-node';
    this.dom = this.wrapper;

    this.container = document.createElement('div');
    this.container.className = 'bn-image-frame';

    this.img = document.createElement('img');
    this.img.draggable = false;

    this.wrapper.appendChild(this.container);
    this.container.appendChild(this.img);

    this.handleDocumentMouseMove = this.handleDocumentMouseMove.bind(this);
    this.handleDocumentMouseUp = this.handleDocumentMouseUp.bind(this);
    this.handleDocumentTouchMove = this.handleDocumentTouchMove.bind(this);
    this.handleDocumentTouchEnd = this.handleDocumentTouchEnd.bind(this);

    this.setupDOM();
    this.createResizeHandles();
  }

  setupDOM() {
    const wrapperStyle =
      this.node.attrs.wrapperStyle || getDefaultWrapperStyle(this.inline);
    const containerStyle =
      this.node.attrs.containerStyle ||
      getDefaultContainerStyle(this.inline, this.node.attrs.width);

    this.wrapper.setAttribute('style', wrapperStyle);
    this.container.setAttribute('style', containerStyle);
    this.wrapper.dataset.layout = getLayoutModeFromWrapperStyle(wrapperStyle);

    applyImageAttributes(this.node.attrs, this.img);
    this.applyResizeLimits();
  }

  getEditorWidth() {
    const width =
      this.wrapper.parentElement?.clientWidth ||
      this.wrapper.parentElement?.getBoundingClientRect?.().width ||
      0;

    return width;
  }

  getActiveMaxWidth() {
    const editorWidth = this.getEditorWidth();
    const layout = this.wrapper.dataset.layout || 'block';
    let maxWidth = Number.isFinite(this.resizeLimits.maxWidth)
      ? this.resizeLimits.maxWidth
      : null;

    if (editorWidth > 0) {
      const responsiveMax =
        layout === 'block' || editorWidth <= 720
          ? editorWidth
          : Math.floor(editorWidth * 0.62);

      maxWidth =
        maxWidth === null ? responsiveMax : Math.min(maxWidth, responsiveMax);
    }

    return maxWidth;
  }

  createResizeHandles() {
    HANDLE_SIDES.forEach((side) => {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = `bn-image-resize-handle bn-image-resize-handle--${side}`;
      handle.setAttribute('aria-label', `Resize image from the ${side}`);

      handle.addEventListener('mousedown', (event) => {
        this.startResize(event.clientX, side);
        event.preventDefault();
        event.stopPropagation();
      });

      handle.addEventListener(
        'touchstart',
        (event) => {
          this.startResize(event.touches[0].clientX, side);
          event.preventDefault();
          event.stopPropagation();
        },
        { passive: false }
      );

      handle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      this.container.appendChild(handle);
    });
  }

  startResize(startX, side) {
    this.resizeState = {
      side,
      startX,
      startWidth: this.container.offsetWidth,
    };

    this.wrapper.classList.add('is-resizing');

    document.addEventListener('mousemove', this.handleDocumentMouseMove);
    document.addEventListener('mouseup', this.handleDocumentMouseUp);
    document.addEventListener('touchmove', this.handleDocumentTouchMove, {
      passive: false,
    });
    document.addEventListener('touchend', this.handleDocumentTouchEnd);
  }

  handleDocumentMouseMove(event) {
    this.applyResizeFromPointer(event.clientX);
  }

  handleDocumentMouseUp() {
    this.finishResize();
  }

  handleDocumentTouchMove(event) {
    this.applyResizeFromPointer(event.touches[0].clientX);
    event.preventDefault();
  }

  handleDocumentTouchEnd() {
    this.finishResize();
  }

  applyResizeFromPointer(pointerX) {
    if (!this.resizeState) return;

    const deltaX = pointerX - this.resizeState.startX;
    const widthDelta = this.resizeState.side === 'left' ? -deltaX : deltaX;

    this.applyWidth(this.resizeState.startWidth + widthDelta);
  }

  applyWidth(width) {
    const nextWidth = clampWidth(width, {
      ...this.resizeLimits,
      maxWidth: this.getActiveMaxWidth(),
    });
    const nextWidthPx = `${nextWidth}px`;

    this.container.style.width = nextWidthPx;
    this.img.style.width = nextWidthPx;
    this.img.setAttribute('width', String(nextWidth));
  }

  applyResizeLimits() {
    const styledWidth = extractWidthFromStyle(this.container.style.cssText);

    if (styledWidth === null) return;

    this.applyWidth(styledWidth);
  }

  finishResize() {
    if (!this.resizeState) return;

    this.resizeState = null;
    this.wrapper.classList.remove('is-resizing');
    this.persistAttributes();
    this.removeDocumentListeners();
  }

  persistAttributes() {
    if (typeof this.getPos !== 'function') return;

    const width = extractWidthFromStyle(this.container.style.cssText);
    const nextAttrs = {
      ...this.node.attrs,
      width: width ?? this.node.attrs.width,
      containerStyle: this.container.style.cssText,
      wrapperStyle: this.wrapper.style.cssText,
    };

    this.editor.commands.command(({ state, dispatch }) => {
      const tr = state.tr.setNodeMarkup(this.getPos(), null, nextAttrs);
      if (dispatch) dispatch(tr);
      return true;
    });
  }

  removeDocumentListeners() {
    document.removeEventListener('mousemove', this.handleDocumentMouseMove);
    document.removeEventListener('mouseup', this.handleDocumentMouseUp);
    document.removeEventListener('touchmove', this.handleDocumentTouchMove);
    document.removeEventListener('touchend', this.handleDocumentTouchEnd);
  }

  selectNode() {
    this.wrapper.classList.add('is-selected');
  }

  deselectNode() {
    this.wrapper.classList.remove('is-selected');
    this.wrapper.classList.remove('is-resizing');
    this.resizeState = null;
    this.removeDocumentListeners();
  }

  update(node) {
    if (node.type.name !== this.node.type.name) return false;

    this.node = node;
    this.setupDOM();

    return true;
  }

  destroy() {
    this.removeDocumentListeners();
  }
}

export async function insertImages(files, callback) {
  const store = useStore();

  for (const file of files) {
    const isImage = file.type.startsWith('image/') && file instanceof File;

    if (!isImage) {
      continue;
    }

    const noteId = store.activeNoteId;
    const name = file.name;
    const timestamp = Date.now();

    if (file.path) {
      const { fileName } = await copyImage(file.path, noteId, timestamp);
      callback(`assets://${noteId}/${fileName}`, name);
    } else {
      const { fileName } = await writeImageFile(file, noteId, timestamp);
      callback(`assets://${noteId}/${fileName}`, name);
    }
  }
}

const handleImagePaste = new Plugin({
  key: new PluginKey('handlePasteLink'),
  props: {
    handleDOMEvents: {
      paste: (view, event) => {
        const clipboardData =
          event.clipboardData || event.originalEvent?.clipboardData;
        if (!clipboardData) return false;

        const items = Array.from(clipboardData.items);
        const files = items
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter(Boolean);

        if (files.length === 0) {
          return false;
        }

        const urls = items.filter(
          (item) => item.kind === 'string' && item.type === 'text/plain'
        );

        if (files.length > 0) {
          event.preventDefault();
          insertImages(files, (src, alt) => {
            const { tr, schema } = view.state;
            const imageNode = schema.nodes.image.create({ src, alt });
            view.dispatch(tr.replaceSelectionWith(imageNode));
          });
        }

        if (urls.length > 0) {
          urls.forEach((urlItem) => {
            urlItem.getAsString((url) => {
              if (url.match(/\.(jpeg|jpg|gif|png)$/i)) {
                const { tr } = view.state;
                view.dispatch(tr.insertText(url, view.state.selection.from));
              }
            });
          });
        }

        return files.length > 0;
      },
    },
  },
});

export default Image.extend({
  name: 'image',

  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      minWidth: 160,
      maxWidth: undefined,
    };
  },

  addAttributes() {
    const inline = this.options.inline;

    return {
      ...this.parent?.(),
      containerStyle: {
        default: null,
        parseHTML: (element) => {
          const containerStyle = element.getAttribute('containerstyle');

          if (containerStyle) {
            return containerStyle;
          }

          const width = element.getAttribute('width');

          return width
            ? getDefaultContainerStyle(inline, `${width}px`)
            : element.style.cssText;
        },
      },
      wrapperStyle: {
        default: getDefaultWrapperStyle(inline),
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) =>
      new ImageNodeView({
        node,
        editor,
        getPos: typeof getPos === 'function' ? getPos : undefined,
        inline: this.options.inline,
        resizeLimits: {
          minWidth: this.options.minWidth,
          maxWidth: this.options.maxWidth,
        },
      });
  },

  addProseMirrorPlugins() {
    return [handleImagePaste];
  },
});
