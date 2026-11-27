/**
 * Shared tool/preset state for every ink surface (note paper, inline ink, PDF
 * markup). One source of truth keeps the palettes identical wherever a pen
 * lands, and the tool choice is a user preference restored on every note open.
 */
import { computed, ref } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { TOOL_DEFAULTS } from '@/lib/tiptap/exts/paper-block/ink/stroke-model.js';

const PRESETS_KEY = 'beaver-paper-presets';
const TOOL_KEY = 'beaver-paper-active-tool';
const PRESET_COUNT = 5;

const DEFAULT_PRESETS = {
  pen: ['#1a1a1a', '#e53e3e', '#3182ce', '#38a169', '#805ad5'],
  pencil: ['#4a4a4a', '#78716c', '#2563eb', '#b45309', '#15803d'],
  fountain: ['#1a2744', '#0f172a', '#7f1d1d', '#065f46', '#4c1d95'],
  marker: ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa'],
};
const PRESET_TOOLS = Object.keys(DEFAULT_PRESETS);
const DRAW_TOOLS = ['pen', 'pencil', 'fountain', 'marker', 'eraser', 'lasso'];

export const PAPER_TYPES = ['transparent', 'plain', 'grid', 'ruled', 'dotted'];

function loadTool() {
  try {
    const t = localStorage.getItem(TOOL_KEY);
    return DRAW_TOOLS.includes(t) ? t : 'pen';
  } catch {
    return 'pen';
  }
}

function loadPresets() {
  try {
    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? 'null');
    if (stored && typeof stored === 'object') {
      const merged = { ...DEFAULT_PRESETS };
      for (const tool of PRESET_TOOLS) {
        // "highlighter" is the legacy key of "marker"; keep user palettes.
        const arr = Array.isArray(stored[tool])
          ? stored[tool]
          : tool === 'marker' && Array.isArray(stored.highlighter)
            ? stored.highlighter
            : null;
        if (arr) {
          merged[tool] = [...arr, ...DEFAULT_PRESETS[tool]].slice(
            0,
            PRESET_COUNT
          );
        }
      }
      return merged;
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PRESETS };
}

const activeTool = ref(loadTool());
const presets = ref(loadPresets());
const activeColor = ref(presets.value[activeTool.value]?.[0] ?? '#1a1a1a');
const customColor = ref(activeColor.value);
const activeSize = ref(TOOL_DEFAULTS[activeTool.value]?.strokeWidth ?? 2);
const toolbarOpen = ref(false);
const activePaperType = ref('plain');

export function useInkToolbar() {
  const { translations } = useTranslations();

  const t = computed(() => translations.value.paperBlock ?? {});
  const toolLabels = computed(() => ({
    pen: t.value.pen ?? 'Pen',
    pencil: t.value.pencil ?? 'Pencil',
    fountain: t.value.fountain ?? 'Fountain pen',
    marker: t.value.marker ?? 'Marker',
    eraser: t.value.eraser ?? 'Eraser',
    lasso: t.value.lasso ?? 'Lasso',
  }));

  const isDrawTool = computed(() => DRAW_TOOLS.includes(activeTool.value));

  function persistTool() {
    try {
      localStorage.setItem(TOOL_KEY, activeTool.value);
    } catch {
      /* ignore */
    }
  }

  function persistPresets() {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.value));
    } catch {
      /* ignore */
    }
  }

  function setTool(id) {
    if (id === 'select') return;
    activeTool.value = id;
    if (PRESET_TOOLS.includes(id)) {
      activeColor.value = presets.value[id]?.[0] ?? activeColor.value;
      customColor.value = activeColor.value;
    }
    activeSize.value = TOOL_DEFAULTS[id]?.strokeWidth ?? 2;
    toolbarOpen.value = false;
    persistTool();
  }

  function selectPreset(index) {
    const color = presets.value[activeTool.value]?.[index];
    if (!color) return;
    activeColor.value = color;
    customColor.value = color;
  }

  function savePreset(index) {
    if (!PRESET_TOOLS.includes(activeTool.value)) return;
    const next = {
      ...presets.value,
      [activeTool.value]: [...(presets.value[activeTool.value] ?? [])],
    };
    next[activeTool.value][index] = activeColor.value;
    presets.value = next;
    persistPresets();
  }

  function applyCustomColor() {
    activeColor.value = customColor.value;
  }

  return {
    t,
    toolLabels,
    isDrawTool,
    presets,
    activeTool,
    activeColor,
    customColor,
    activeSize,
    toolbarOpen,
    activePaperType,
    setTool,
    selectPreset,
    savePreset,
    applyCustomColor,
  };
}
