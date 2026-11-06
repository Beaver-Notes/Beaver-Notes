import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import PdfBlockComponent from '../PdfBlockComponent.vue';
import MarkupEditor from '../MarkupEditor.vue';

const h = vi.hoisted(() => ({ stubs: [], toolbars: [] }));

vi.mock('../../paper-block/PaperToolbar.vue', async () => {
  const { defineComponent: dc } = await import('vue');
  return {
    default: dc({
      name: 'PaperToolbarStub',
      props: [
        'tools',
        'tool',
        'paperTypes',
        'background',
        'currentToolColor',
        'currentToolSize',
        'activePresets',
        'canUndo',
        'canRedo',
      ],
      emits: ['tool', 'color', 'color-input', 'save-preset', 'size', 'bg', 'undo', 'redo'],
      setup(props, { emit }) {
        h.toolbars.push({ emit, props });
        return { emit };
      },
      template: '<div class="paper-toolbar-stub" />',
    }),
  };
});

vi.mock('../../paper-block/PaperSurface.vue', async () => {
  const { defineComponent: dc } = await import('vue');
  return {
    default: dc({
      name: 'PaperSurfaceStub',
      props: [
        'strokes',
        'tool',
        'toolSettings',
        'height',
        'paperType',
        'media',
        'chrome',
        'focused',
        'nodeKey',
        'hint',
      ],
      emits: ['commit', 'update-strokes', 'focus-request', 'height-change'],
      setup(_, { emit }) {
        h.stubs.push({ emit });
        return { emit };
      },
      template: '<div class="paper-surface-stub" />',
    }),
  };
});

vi.mock('../../paper-block/InkPreview.vue', () => ({
  default: defineComponent({
    name: 'InkPreviewStub',
    props: ['strokes', 'width', 'height'],
    template: '<canvas class="ink-preview-stub" />',
  }),
}));

vi.mock('../pdfSource.js', () => ({
  openPdf: vi.fn(async () => ({
    numPages: 1,
    pageDims: Promise.resolve([{ width: 612, height: 792 }]),
    renderPage: vi.fn(async () => {}),
  })),
}));

vi.mock('@/lib/tauri/scoped-storage', () => ({
  resolveAssetPath: vi.fn(async () => '/app/assets/n1/doc.pdf'),
}));

vi.mock('@/lib/native/fs', () => ({
  readFileBinaryBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock('@/composable/useTranslations', () => ({
  // real composable shape: returns { translations } only — no t() helper
  useTranslations: () => ({ translations: ref({}) }),
}));

const RemixStub = defineComponent({
  name: 'VRemixicon',
  props: ['name'],
  template: '<i />',
});

function mountBlock(attrs = {}, { selected = false } = {}) {
  const dispatch = vi.fn();
  const tr = {
    replaceWith(from, to, node) {
      tr.last = [from, to, node];
      return tr;
    },
  };
  const wrapper = mount(PdfBlockComponent, {
    props: {
      editor: {
        commands: { undo: vi.fn(), redo: vi.fn(), setNodeSelection: vi.fn() },
        view: {
          dispatch,
          state: {
            tr,
            schema: {
              nodes: {
                fileEmbed: {
                  create: (a) => ({ type: { name: 'fileEmbed' }, attrs: a }),
                },
              },
            },
          },
        },
      },
      node: {
        attrs: { src: 'file-assets://n1/doc.pdf', markup: '[]', ...attrs },
      },
      updateAttributes: vi.fn(),
      selected,
      getPos: () => 0,
    },
    global: {
      stubs: { Teleport: true },
      components: { 'v-remixicon': RemixStub },
    },
  });
  return { wrapper, dispatch, tr, setNodeSelection: wrapper.props('editor').commands.setNodeSelection };
}

describe('pdf-block', () => {
  afterEach(() => {
    h.stubs.length = 0;
    h.toolbars.length = 0;
    vi.clearAllMocks();
  });

  it('fixture is a valid PDF header', () => {
    const bytes = readFileSync(
      'src/lib/tiptap/exts/pdf-block/__tests__/fixtures/tiny.pdf',
    );
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders an error block and no rail when bytes fail to load', async () => {
    const { openPdf } = await import('../pdfSource.js');
    openPdf.mockRejectedValueOnce(new Error('bad bytes'));
    const { wrapper } = mountBlock();
    await flushPromises();
    expect(wrapper.find('.pdf-error').exists()).toBe(true);
    expect(wrapper.find('.pdf-rail').exists()).toBe(false);
  });

  it('renders one page in the rail and the filmstrip toggle', async () => {
    const { wrapper } = mountBlock();
    await flushPromises();
    expect(wrapper.findAll('.pdf-rail-page')).toHaveLength(1);
    expect(wrapper.find('.pdf-filmstrip').element.style.display).toBe('none');
    await wrapper.find('.pdf-thumbs-toggle').trigger('click');
    expect(wrapper.findAll('.pdf-thumb')).toHaveLength(1);
    expect(wrapper.find('.pdf-filmstrip').element.style.display).toBe('');
  });

  it('renders inline data: pdfs without touching the asset path', async () => {
    const { openPdf } = await import('../pdfSource.js');
    const { resolveAssetPath } = await import('@/lib/tauri/scoped-storage');
    // b64([1,2,3]) = 'AQID'
    const { wrapper } = mountBlock({
      src: 'data:application/pdf;base64,AQID',
    });
    await flushPromises();
    expect(openPdf.mock.calls[0]?.[0]).toEqual(new Uint8Array([1, 2, 3]));
    expect(resolveAssetPath).not.toHaveBeenCalled();
    expect(wrapper.findAll('.pdf-rail-page')).toHaveLength(1);
  });

  it('fetches asset bytes through the protocol and falls back to fs reads', async () => {
    const { openPdf } = await import('../pdfSource.js');
    const { resolveAssetPath } = await import('@/lib/tauri/scoped-storage');
    const fakeBytes = new Uint8Array([9, 8, 7]);
    const realFetch = globalThis.fetch;
    let fetchInit = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      fetchInit = init;
      return {
        ok: true,
        arrayBuffer: async () => fakeBytes.buffer,
      };
    });
    try {
      // protocol path: assets:// served decrypted by the Tauri custom protocol
      mountBlock({ src: 'assets://n1/doc.pdf' });
      await flushPromises();
      expect(openPdf.mock.calls[0]?.[0]).toEqual(fakeBytes);
      // range request bypasses the protocol handler's 16 MiB full-read cap
      // (bootstrap.rs serve_asset truncates non-range bodies silently)
      expect(fetchInit?.headers).toEqual({ Range: 'bytes=0-' });

      // fallback: fetch failure → legacy raw read (current behavior)
      openPdf.mockClear();
      resolveAssetPath.mockClear();
      globalThis.fetch = vi.fn(async () => {
        throw new Error('blocked');
      });
      mountBlock({ src: 'assets://n1/doc.pdf' });
      await flushPromises();
      expect(resolveAssetPath).toHaveBeenCalledWith('assets://n1/doc.pdf');
      expect(openPdf.mock.calls[0]?.[0]).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('splits rail commits into page-local stored strokes', async () => {
    const { wrapper } = mountBlock();
    await flushPromises();
    const surface = h.stubs.at(-1);
    const scale = 200 / 792; // rail height / page height
    surface.emit('commit', {
      id: 'r1',
      tool: 'pen',
      color: '#1a1a1a',
      size: 4,
      opacity: 1,
      points: [
        [10, 20, 0.5],
        [30, 40, 0.7],
      ],
    });
    await flushPromises();
    const payload = wrapper.props('updateAttributes').mock.calls.at(-1)[0];
    expect(payload.markup).toHaveLength(1);
    const stored = payload.markup[0];
    expect(stored.id).toBe('r1');
    expect(stored.page).toBe(0);
    expect(stored.points[0][0]).toBeCloseTo(10 / scale, 5);
    expect(stored.points[1][1]).toBeCloseTo(40 / scale, 5);
  });

  it('sizes the rail from the height attr and shows resize chrome when selected', async () => {
    const { wrapper } = mountBlock({ height: 260 }, { selected: true });
    await flushPromises();
    const surface = h.stubs.at(-1);
    expect(wrapper.findComponent({ name: 'PaperSurfaceStub' }).props('height')).toBe(260);
    expect(wrapper.findComponent({ name: 'PaperSurfaceStub' }).props('chrome')).toBe(true);
    surface.emit('height-change', 300);
    await flushPromises();
    expect(wrapper.props('updateAttributes').mock.calls.at(-1)[0]).toEqual({
      height: 300,
    });

    // unselected → no resize chrome
    h.stubs.length = 0;
    const { wrapper: idle } = mountBlock({ height: 260 });
    await flushPromises();
    expect(idle.findComponent({ name: 'PaperSurfaceStub' }).props('chrome')).toBe(false);
  });

  it('header click selects the block so resize handles appear', async () => {
    const { wrapper, setNodeSelection } = mountBlock();
    await flushPromises();
    await wrapper.find('.pdf-header').trigger('click');
    expect(setNodeSelection).toHaveBeenCalledWith(0);
  });

  it('re-renders pages when the block height changes', async () => {
    const { openPdf } = await import('../pdfSource.js');
    const { wrapper } = mountBlock({ height: 200 });
    await flushPromises();
    const pdf = await openPdf.mock.results[0].value;
    const afterLoad = pdf.renderPage.mock.calls.length;
    expect(afterLoad).toBeGreaterThan(0);
    await wrapper.setProps({
      node: { attrs: { src: 'file-assets://n1/doc.pdf', markup: '[]', height: 300 } },
    });
    await flushPromises();
    expect(pdf.renderPage.mock.calls.length).toBeGreaterThan(afterLoad);
  });

  it('keeps thumbnails at a fixed small height regardless of block height', async () => {
    const { wrapper } = mountBlock({ height: 320 });
    await flushPromises();
    expect(wrapper.find('.pdf-thumb canvas').element.height).toBe(120);
    expect(wrapper.find('.pdf-rail-page').element.height).toBe(320);
  });

  it('offers the shared toolbar with draw tools only when selected', async () => {
    const { wrapper } = mountBlock({}, { selected: true });
    await flushPromises();
    expect(h.toolbars.length).toBeGreaterThanOrEqual(1);
    const bar = h.toolbars.at(-1);
    const ids = bar.props.tools.map((t) => t.id);
    for (const id of ids) expect(['pen', 'pencil', 'fountain', 'marker']).toContain(id);
    expect(bar.props.paperTypes).toEqual([]); // no paper backgrounds on PDFs
    bar.emit('tool', 'pencil');
    await flushPromises();
    const surface = wrapper.findComponent({ name: 'PaperSurfaceStub' });
    expect(surface.props('tool')).toBe('pencil');
  });

  it('converts back to a file embed keeping markup', async () => {
    const { wrapper, dispatch, tr } = mountBlock({
      src: 'assets://n1/doc.pdf',
      fileName: 'doc.pdf',
      markup: [{ id: 's1', tool: 'pen', color: '#000', size: 4, opacity: 1, points: [[0, 0, 0.5]] }],
    });
    await flushPromises();
    await wrapper.find('.pdf-convert-back').trigger('click');
    expect(dispatch).toHaveBeenCalledWith(tr);
    const [, , node] = tr.last;
    expect(node.type.name).toBe('fileEmbed');
    expect(node.attrs).toEqual({
      src: 'assets://n1/doc.pdf',
      fileName: 'doc.pdf',
      markup: expect.any(Array),
    });
    expect(node.attrs.markup[0].id).toBe('s1');
  });
});

describe('MarkupEditor', () => {
  afterEach(() => {
    h.stubs.length = 0;
    h.toolbars.length = 0;
    vi.clearAllMocks();
  });

  function overlayOffsetX() {
    // happy-dom viewport 1024px; margin = min(48, 5%) = 48
    const scale = Math.min(1.5, (1024 - 96) / 612);
    return Math.round((1024 - 612 * scale) / 2);
  }

  it('offsets page strokes into the viewport and strips the offset on commit', async () => {
    const wrapper = mount(MarkupEditor, {
      props: {
        pages: [{ width: 612, height: 792 }],
        doc: { renderPage: vi.fn(async () => {}) },
        strokes: [
          {
            id: 's1',
            tool: 'pen',
            color: '#000',
            size: 4,
            opacity: 1,
            page: 0,
            points: [
              [10, 20, 0.5],
              [40, 60, 0.5],
            ],
          },
        ],
        initialPage: 0,
        tool: 'pen',
        toolSettings: {},
        canUndo: false,
        canRedo: false,
      },
      global: {
        stubs: { Teleport: true },
        components: { 'v-remixicon': RemixStub },
      },
    });
    await flushPromises();
    const surface = h.stubs.at(-1);
    const overlay = wrapper.findComponent({ name: 'PaperSurfaceStub' });
    const points = overlay.props('strokes')[0].points;
    expect(points[0][0]).toBe(10 + overlayOffsetX());

    surface.emit('commit', {
      id: 's2',
      tool: 'pen',
      color: '#000',
      size: 4,
      opacity: 1,
      points: [
        [100 + overlayOffsetX(), 20, 0.5],
        [120 + overlayOffsetX(), 40, 0.5],
      ],
    });
    await flushPromises();
    const out = wrapper.emitted('commit').at(-1)[0];
    expect(out.points[0][0]).toBe(100);
  });

  it('renders one page surface per document page within the active window', async () => {
    const wrapper = mount(MarkupEditor, {
      props: {
        pages: [
          { width: 612, height: 792 },
          { width: 612, height: 792 },
          { width: 612, height: 792 },
        ],
        doc: { renderPage: vi.fn(async () => {}) },
        strokes: [],
        initialPage: 0,
        tool: 'pen',
        toolSettings: {},
        canUndo: false,
        canRedo: false,
      },
      global: {
        stubs: { Teleport: true },
        components: { 'v-remixicon': RemixStub },
      },
    });
    await flushPromises();
    // active window ±1 around page 0 → pages 0 and 1 get overlays
    expect(wrapper.findAllComponents({ name: 'PaperSurfaceStub' })).toHaveLength(2);
  });

  it('replaces the ad-hoc pill with the shared paper toolbar', async () => {
    const wrapper = mount(MarkupEditor, {
      props: {
        pages: [{ width: 612, height: 792 }],
        doc: { renderPage: vi.fn(async () => {}) },
        strokes: [],
        initialPage: 0,
        tool: 'pen',
        toolSettings: { pen: { color: '#1a1a1a', size: 4, opacity: 1 } },
        canUndo: true,
        canRedo: false,
      },
      global: {
        stubs: { Teleport: true },
        components: { 'v-remixicon': RemixStub },
      },
    });
    await flushPromises();
    expect(wrapper.find('.markup-toolbar').exists()).toBe(false);
    expect(wrapper.find('.markup-done').exists()).toBe(true);
    expect(h.toolbars).toHaveLength(1);
    const bar = h.toolbars[0];
    expect(bar.props.paperTypes).toEqual([]); // no paper backgrounds on PDFs
    expect(bar.props.canUndo).toBe(true);
    // tool + color events forward to the parent
    bar.emit('tool', 'marker');
    bar.emit('color', '#fbbf24');
    bar.emit('size', 16);
    bar.emit('undo');
    await flushPromises();
    expect(wrapper.emitted('tool').at(-1)).toEqual(['marker']);
    expect(wrapper.emitted('color').at(-1)).toEqual(['#fbbf24']);
    expect(wrapper.emitted('size').at(-1)).toEqual([16]);
    expect(wrapper.emitted('undo')).toHaveLength(1);
    await wrapper.find('.markup-done').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
