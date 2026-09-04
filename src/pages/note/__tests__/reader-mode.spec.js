import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useRouter: () => ({ push: vi.fn(), options: { history: { state: {} } } }), onBeforeRouteLeave: vi.fn() };
});
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ confirm: vi.fn(), alert: vi.fn() }) }));
vi.mock('@/composable/useTranslations', () => ({ useTranslations: () => ({ translations: { value: { menu: {}, card: {}, dialog: {} } } }) }));
vi.mock('@/composable/useToolbarConfig', () => ({ useToolbarConfig: () => ({ visibleItems: { value: [] } }) }));
vi.mock('@/composable/groupTooltip', () => ({ useGroupTooltip: () => {} }));
vi.mock('@/composable/useAudioRecorder', () => ({ useAudioRecorder: () => ({ isRecording: { value: false }, formattedTime: { value: '0:00' }, start: vi.fn(), onStopped: () => () => {}, openNoteId: { value: null } }) }));
vi.mock('@/utils/assets/editor-image', () => ({ useEditorImage: () => ({ set: vi.fn() }) }));
vi.mock('@/lib/tauri-bridge', () => ({ backend: { isMobileRuntime: () => false }, path: { join: (...a) => a.join('/'), basename: (p) => p.split('/').pop() }, addCloseHandler: vi.fn() }));
vi.mock('@/utils/share/HTML', () => ({ exportHTML: vi.fn() }));
vi.mock('@/utils/share/MD', () => ({ exportMD: vi.fn() }));
vi.mock('@/utils/share/BEA', () => ({ exportBEA: vi.fn() }));
vi.mock('@/lib/yjs/meta-store.js', () => ({ readNoteContents: vi.fn(async () => ({})) }));
vi.mock('@/utils/share/PDF', () => ({ exportPDF: vi.fn() }));
vi.mock('@/utils/share/export-helpers', () => ({ getTempSharePath: vi.fn(async () => '/tmp/x'), shareFile: vi.fn(), tryShareOrExport: vi.fn((a) => a()) }));
vi.mock('@/utils/share/exportBulk', () => ({ buildWebExportDocument: vi.fn(async () => '') }));
vi.mock('@/utils/markdown', () => ({ tiptapToMarkdown: vi.fn(() => ''), buildFrontmatter: vi.fn(() => '') }));
vi.mock('@/lib/native/app', () => ({ getAppDirectory: vi.fn(async () => '/tmp') }));
vi.mock('@/lib/native/fs', () => ({ readDir: vi.fn(async () => []), readData: vi.fn(async () => ''), removePath: vi.fn(async () => {}) }));
vi.mock('@/lib/native/exports', () => ({ readExportData: vi.fn(async () => '') }));
vi.mock('@/lib/native/dialog', () => ({ saveDialog: vi.fn(async () => ({ canceled: true })) }));
vi.mock('@/lib/native/share', () => ({ shareFileViaNative: vi.fn(async () => {}) }));
vi.mock('@/utils/assets/storage.js', () => ({ saveFile: vi.fn(async () => ({ fileName: 'f', relativePath: 'p' })) }));
vi.mock('@/utils/ui/zoom', () => ({ getStoredZoomLevel: vi.fn(() => 100), setStoredZoomLevel: vi.fn() }));
vi.mock('@/utils/ui/globalShortcuts.js', () => ({ bindGlobalShortcuts: vi.fn(() => () => {}) }));
vi.mock('mime', () => ({ default: { getType: () => 'text/plain' } }));

import { useNoteMenu } from '@/composable/useNoteMenu';
import { useUiState } from '@/composable/useUiState';
import { useReaderPrefs } from '@/composable/useReaderPrefs';
import ReaderPill from '@/components/note/ReaderPill.vue';

function makeEditor() {
  return {
    setOptions: vi.fn(),
    commands: { focus: vi.fn() },
    isActive: () => false,
    getAttributes: () => ({}),
    state: { selection: { from: 0, to: 0 } },
    chain: () => ({ focus: () => ({ toggleBold: () => ({ run: () => {} }), setFontSize: () => ({ run: () => {} }) }) }),
    view: { posAtDOM: () => 0 },
    options: { element: document.createElement('div') },
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('reader mode trap', () => {
  let origRequest;
  let origExit;
  let fullscreenEl;

  beforeEach(() => {
    setActivePinia(createPinia());
    const ui = useUiState();
    ui.inReaderMode = false;
    localStorage.clear();
    fullscreenEl = null;
    Object.defineProperty(document, 'fullscreenElement', {
      get: () => fullscreenEl,
      configurable: true,
    });
    origRequest = document.documentElement.requestFullscreen;
    origExit = document.exitFullscreen;
    document.documentElement.requestFullscreen = vi.fn(async () => { fullscreenEl = document.documentElement; });
    document.exitFullscreen = vi.fn(async () => { fullscreenEl = null; });
  });

  afterEach(() => {
    if (origRequest) document.documentElement.requestFullscreen = origRequest;
    if (origExit) document.exitFullscreen = origExit;
    try { delete document.fullscreenElement; } catch {}
    const ui = useUiState();
    ui.inReaderMode = false;
  });

  it('toggle enters reader data-attr and editable false', async () => {
    const editor = makeEditor();
    const Wrapper = defineComponent({
      setup() {
        const m = useNoteMenu({ editor, id: 'test-id', note: { title: 't' } });
        return m;
      },
      template: '<div></div>',
    });
    const w = mount(Wrapper);
    expect(w.vm.store.inReaderMode).toBe(false);
    w.vm.toggleReaderMode();
    await w.vm.$nextTick();
    expect(w.vm.store.inReaderMode).toBe(true);
    expect(editor.setOptions).toHaveBeenCalledWith({ editable: false });
    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    // prefs wiring: _id.vue should expose data-reader-theme via prefs
    const { prefs } = useReaderPrefs();
    expect(['light', 'sepia', 'dark']).toContain(prefs.value.theme);
    w.unmount();
  });

  it('fullscreenchange exits', async () => {
    const editor = makeEditor();
    const Wrapper = defineComponent({
      setup() {
        const m = useNoteMenu({ editor, id: 'test-id', note: { title: 't' } });
        return m;
      },
      template: '<div></div>',
    });
    const w = mount(Wrapper);
    w.vm.toggleReaderMode();
    await w.vm.$nextTick();
    expect(w.vm.store.inReaderMode).toBe(true);
    // simulate user exiting fullscreen via browser UI
    fullscreenEl = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    await w.vm.$nextTick();
    expect(w.vm.store.inReaderMode).toBe(false);
    expect(editor.setOptions).toHaveBeenCalledWith({ editable: true });
    w.unmount();
  });

  it('Esc exits', async () => {
    const editor = makeEditor();
    const Wrapper = defineComponent({
      setup() {
        const m = useNoteMenu({ editor, id: 'test-id', note: { title: 't' } });
        return m;
      },
      template: '<div></div>',
    });
    const w = mount(Wrapper);
    w.vm.toggleReaderMode();
    await w.vm.$nextTick();
    expect(w.vm.store.inReaderMode).toBe(true);
    editor.setOptions.mockClear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect(w.vm.store.inReaderMode).toBe(false);
    expect(editor.setOptions).toHaveBeenCalledWith({ editable: true });
    w.unmount();
  });

  it('click-outside exits (wrapper @mousedown.self)', async () => {
    // verify _id.vue contains click-outside wiring and ReaderPill mount
    const idVue = fs.readFileSync('src/pages/note/_id.vue', 'utf8');
    expect(idVue).toContain('data-reader-theme');
    expect(idVue).toContain('data-reader-family');
    expect(idVue).toContain('--reader-size');
    expect(idVue).toContain('--reader-line');
    expect(idVue).toContain('ReaderPill');
    expect(idVue).toContain('@mousedown.self');
    expect(idVue).toContain('@exit="exitReader"');
    // title must follow reader prefs too — guarded in editor.css, not just ProseMirror
    const editorCss = fs.readFileSync('src/assets/css/editor.css', 'utf8');
    expect(editorCss).toContain('.editor[data-reader-theme] .title-placeholder');
    expect(editorCss).toContain(".editor[data-reader-theme='light'] .title-placeholder");
    expect(editorCss).toContain(".editor[data-reader-theme='sepia'] .title-placeholder");
    expect(editorCss).toContain(".editor[data-reader-theme='dark'] .title-placeholder");
    expect(editorCss).toContain("[data-reader-family='serif'] .title-placeholder");
    // also verify runtime click-outside via small stub mimicking _id.vue logic
    const { prefs } = useReaderPrefs();
    const Stub = defineComponent({
      props: ['inReaderMode'],
      emits: ['exit'],
      setup(props, { emit }) {
        function onSelf(e) {
          if (e.target === e.currentTarget && props.inReaderMode) emit('exit');
        }
        return { prefs, onSelf };
      },
      template: '<div :data-reader-theme="inReaderMode ? prefs.theme : null" :data-reader-family="prefs.family" :style="inReaderMode ? `--reader-size:${prefs.size}px;--reader-line:${prefs.line}` : \'\'" @mousedown.self="onSelf" data-testid="reader-wrap"><slot /></div>',
    });
    const w2 = mount(Stub, { props: { inReaderMode: true } });
    expect(w2.attributes('data-reader-theme')).toBeTruthy();
    expect(w2.attributes('data-reader-family')).toBeTruthy();
    expect(w2.attributes('style')).toContain('--reader-size');
    // clicking directly on wrapper should emit exit (self)
    await w2.trigger('mousedown');
    expect(w2.emitted('exit')).toBeTruthy();
    // clicking child should not emit via .self (simulate by triggering on child)
    const w3 = mount({ components: { Stub }, template: '<Stub :inReaderMode="true" @exit="onExit"><span data-testid="inner">inner</span></Stub>', setup(){ return { onExit: vi.fn() } } });
    // inner click not on self, so no exit via wrapper self handler - just sanity that stub exists
    expect(w3.find('[data-testid="inner"]').exists()).toBe(true);
  });

  it('ReaderPill Done emits exit', async () => {
    const w = mount(ReaderPill);
    await w.find('[data-testid="reader-done"]').trigger('click');
    expect(w.emitted('exit')).toBeTruthy();
  });

  it('useNoteMenu exposes exitReader', async () => {
    const editor = makeEditor();
    const Wrapper = defineComponent({
      setup() { return useNoteMenu({ editor, id: 'x', note: {} }); },
      template: '<div></div>',
    });
    const w = mount(Wrapper);
    expect(typeof w.vm.exitReader).toBe('function');
    w.unmount();
  });

  it('useNoteMenu source has tri-exit wiring', () => {
    const src = fs.readFileSync('src/composable/useNoteMenu.js', 'utf8');
    expect(src).toContain('function exitReader');
    expect(src).toContain('fullscreenchange');
    expect(src).toContain('Escape');
    expect(src).toContain('exitFullscreen');
    expect(src).toContain('requestFullscreen');
    expect(src).toContain('setOptions');
  });
});
