import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { ImageNodeView } from '../image';
import VideoComponent from '../video-block/VideoComponent.vue';
import AudioComponent from '../audio-block/AudioComponent.vue';

// Render-sink guards (SC-4-02 round 2): live-Yjs attrs bypass parseHTML
// getAttrs, so the node views themselves must refuse unsafe srcs.
vi.mock('@/store', () => ({ useStore: () => ({ activeNoteId: 'note-1' }) }));
vi.mock('@/utils/assets/storage.js', () => ({
  default: vi.fn(),
  writeImageFile: vi.fn(),
}));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: {} }),
}));

function imageSrcFor(src) {
  const view = new ImageNodeView({
    node: { type: { name: 'image' }, attrs: { src, alt: 'x' } },
    editor: {},
    getPos: undefined,
    resizeLimits: {},
  });
  return view.img.getAttribute('src');
}

function mountMedia(Component, src, fileName = 'x.mp4') {
  return mount(Component, {
    props: {
      node: { attrs: { src, fileName } },
      editor: {},
      selected: false,
      decorations: [],
      extension: {},
      getPos: () => 0,
      updateAttributes: () => {},
      deleteNode: () => {},
    },
  });
}

describe('image render sink (SC-4-02 Yjs path)', () => {
  it.each([
    'assets://n1/a.png',
    'file-assets://n1/a.png',
    'blob:550e8400',
    'https://example.com/a.png',
    'data:image/png;base64,AAA=',
  ])('renders legit src %s', (src) => {
    expect(imageSrcFor(src)).toBe(src);
  });

  it.each([
    'file:///etc/passwd',
    'http://example.com/a.png',
    'javascript:alert(1)',
    'data:text/html;base64,PGltZz4=',
  ])('drops unsafe src %s from the DOM', (src) => {
    expect(imageSrcFor(src)).toBeNull();
  });

  it('keeps empty src for pending inserts', () => {
    expect(imageSrcFor('')).toBe('');
  });
});

describe('video render sink (SC-4-02 Yjs path)', () => {
  it.each(['assets://n1/a.mp4', 'https://example.com/a.mp4'])(
    'renders legit src %s',
    async (src) => {
      const wrapper = mountMedia(VideoComponent, src);
      await nextTick();
      expect(wrapper.find('video').attributes('src')).toBe(src);
    }
  );

  it.each([
    'file:///C:/x.mp4',
    'http://example.com/a.mp4',
    'javascript:alert(1)',
    'data:text/html;base64,PGltZz4=',
  ])('drops unsafe src %j', async (src) => {
    const wrapper = mountMedia(VideoComponent, src);
    await nextTick();
    expect(wrapper.find('video').attributes('src')).toBe('');
    expect(wrapper.find('iframe').exists()).toBe(false);
  });
});

describe('audio render sink (SC-4-02 Yjs path)', () => {
  it('renders legit assets:// src', async () => {
    const wrapper = mountMedia(AudioComponent, 'assets://n1/a.mp3', 'a.mp3');
    await nextTick();
    expect(wrapper.find('audio').attributes('src')).toBe('assets://n1/a.mp3');
  });

  it.each(['file:///etc/x.mp3', 'javascript:alert(1)'])(
    'drops unsafe src %j',
    async (src) => {
      const wrapper = mountMedia(AudioComponent, src, 'x.mp3');
      await nextTick();
      expect(wrapper.find('audio').attributes('src')).toBe('');
    }
  );
});
