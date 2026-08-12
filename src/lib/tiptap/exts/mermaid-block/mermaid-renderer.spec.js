import { describe, it, expect, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';
import MermaidRenderer from './mermaid-renderer.vue';

vi.mock('@/composable/theme', () => ({
  useTheme: () => ({ isDark: () => false }),
}));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({
    translations: ref({
      editor: { error: 'Invalid syntax' },
    }),
  }),
}));

function mount(content) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    components: { MermaidRenderer },
    template: '<mermaid-renderer :content="content" />',
    data: () => ({ content }),
  });
  app.mount(host);
  return { host, app, unmount: () => { app.unmount(); host.remove(); } };
}

describe('mermaid-renderer', () => {
  it('renders an SVG for a supported diagram type', async () => {
    const { host, unmount } = mount('graph TD\n  A --> B');
    await nextTick();
    expect(host.querySelector('.mermaid-viewer svg')).toBeTruthy();
    unmount();
  });

  it('shows raw source with a badge for an unsupported diagram type', async () => {
    const { host, unmount } = mount('pie\n  "Cats" : 7\n  "Dogs" : 3');
    await nextTick();
    expect(host.querySelector('.mermaid-viewer svg')).toBeFalsy();
    expect(host.querySelector('.mermaid-fallback-badge')).toBeTruthy();
    expect(host.querySelector('.mermaid-fallback-code').textContent).toContain('pie');
    unmount();
  });

  it('shows raw source with a red error for invalid syntax', async () => {
    const { host, unmount } = mount('graph\n  A --> B');
    await nextTick();
    expect(host.querySelector('.mermaid-viewer svg')).toBeFalsy();
    expect(host.querySelector('.mermaid-fallback-error')).toBeTruthy();
    expect(host.querySelector('.mermaid-fallback-code').textContent).toContain('graph');
    unmount();
  });
});
