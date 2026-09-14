import { ref, watch } from 'vue';
export const STORAGE_KEY = 'beaver:reader-prefs';
const DEFAULTS = { theme:'light', size:18, line:1.75, family:'default' };
const validFamilies = ['default','serif','sans'];
const prefs = ref({ ...DEFAULTS });
let hydrating = false;
function load() { hydrating = true; prefs.value = { ...DEFAULTS }; try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return; const p = JSON.parse(raw);
  if (['light','sepia','dark'].includes(p.theme)) prefs.value.theme = p.theme;
  if (typeof p.size==='number' && p.size>=12 && p.size<=32) prefs.value.size = p.size;
  if (typeof p.line==='number' && p.line>=1.2 && p.line<=2.4) prefs.value.line = p.line;
  if (validFamilies.includes(p.family)) prefs.value.family = p.family;
  else if (p.family === 'serif' || p.family === 'sans') prefs.value.family = p.family;
} catch {} finally { hydrating = false; } }
function persist() { if (hydrating) return; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs.value)); } catch {} }
watch(prefs, persist, { deep:true, flush:'sync' });
export function useReaderPrefs(){ return { prefs, setTheme(t){ prefs.value.theme=t; }, setSize(n){ prefs.value.size=n; }, setLine(n){ prefs.value.line=n; }, setFamily(f){ prefs.value.family=f; }, hydrate: load }; }
load();
