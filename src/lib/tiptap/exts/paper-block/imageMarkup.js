import { createApp, h, reactive } from 'vue';
import PaperSurface from './PaperSurface.vue';
import { TOOL_DEFAULTS, parseStrokes } from './ink/stroke-model.js';

function cloneDefaults() {
  const settings = {};
  Object.entries(TOOL_DEFAULTS).forEach(([tool, value]) => {
    settings[tool] = { ...value };
  });
  return settings;
}

/**
 * Mounts the shared PaperSurface ink engine over an image node view.
 * Image bounds are fixed: height-change is ignored so strokes clip at the
 * image edge instead of growing the surface.
 */
export function mountImageMarkup({
  host,
  strokes = [],
  nodeKey,
  height = 200,
  onCommit,
  onUpdateStrokes,
}) {
  const state = reactive({
    strokes: parseStrokes(strokes),
    tool: 'pen',
    toolSettings: cloneDefaults(),
    height,
  });

  const app = createApp({
    render: () =>
      h(PaperSurface, {
        strokes: state.strokes,
        focused: true,
        tool: state.tool,
        toolSettings: state.toolSettings,
        height: state.height,
        paperType: 'transparent',
        media: true,
        nodeKey,
        hint: '',
        onCommit: (stroke) => onCommit([...state.strokes, stroke]),
        onUpdateStrokes: (next) => onUpdateStrokes(next),
        onHeightChange: () => {},
        onFocusRequest: () => {},
      }),
  });
  app.mount(host);

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      const next = host.clientHeight;
      if (next > 0) state.height = next;
    });
    ro.observe(host);
  }

  return {
    setStrokes(next) {
      state.strokes = parseStrokes(next);
    },
    destroy() {
      if (ro) ro.disconnect();
      app.unmount();
    },
  };
}
