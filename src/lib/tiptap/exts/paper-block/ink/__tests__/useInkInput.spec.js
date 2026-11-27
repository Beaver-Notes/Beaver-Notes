import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

vi.mock('@/lib/native/scribble', () => ({
  setScribbleSuppressed: vi.fn(),
  clearScribbleSuppressed: vi.fn(),
}));

import { setScribbleSuppressed, clearScribbleSuppressed } from '@/lib/native/scribble';
import { useInkInput } from '@/composable/useInkInput.js';

function setup(isFinding = false) {
  const finding = ref(isFinding);
  const ui = useInkInput({ isFinding: finding });
  return { ...ui, finding };
}

describe('useInkInput — scribble scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('beginStroke suppresses scribble for that id only while in flight', () => {
    const { beginStroke, endStroke, strokeActive } = setup();
    expect(beginStroke('s1')).toBe(true);
    expect(setScribbleSuppressed).toHaveBeenCalledWith('ink:s1', true);
    expect(strokeActive.value).toBe(true);

    endStroke('s1');
    expect(clearScribbleSuppressed).toHaveBeenCalledWith('ink:s1');
    expect(strokeActive.value).toBe(false);
  });

  it('a stale endStroke from a different id cannot clear another stroke suppression', () => {
    const { beginStroke, endStroke } = setup();
    beginStroke('s1');
    vi.clearAllMocks();

    endStroke('s2'); // stale end for a different stroke
    expect(clearScribbleSuppressed).not.toHaveBeenCalled();
    expect(setScribbleSuppressed).not.toHaveBeenCalledWith('ink:s1', false);

    // the real end for s1 still clears it
    endStroke('s1');
    expect(clearScribbleSuppressed).toHaveBeenCalledWith('ink:s1');
  });

  it('endStroke with no matching active id is a no-op', () => {
    const { endStroke } = setup();
    expect(endStroke('ghost')).toBe(false);
    expect(clearScribbleSuppressed).not.toHaveBeenCalled();
  });
});

describe('useInkInput — find-mode gate (A8)', () => {
  it('isFinding blocks beginStroke and never suppresses', () => {
    const finding = ref(true);
    const { beginStroke } = useInkInput({ isFinding: finding });
    expect(beginStroke('s1')).toBe(false);
    expect(setScribbleSuppressed).not.toHaveBeenCalled();
  });

  it('the finding ref is exposed and reactive', () => {
    const finding = ref(false);
    const { finding: f, beginStroke } = useInkInput({ isFinding: finding });
    expect(f).toBe(finding);

    finding.value = true;
    expect(beginStroke('s1')).toBe(false);
    expect(setScribbleSuppressed).not.toHaveBeenCalled();

    finding.value = false;
    expect(beginStroke('s1')).toBe(true);
    expect(setScribbleSuppressed).toHaveBeenCalledWith('ink:s1', true);
  });

  it('defaults to not-finding when no isFinding passed', () => {
    const { beginStroke } = setup();
    expect(beginStroke('s1')).toBe(true);
    expect(setScribbleSuppressed).toHaveBeenCalledWith('ink:s1', true);
  });
});

describe('useInkInput — unmount cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cleanup always clears what it set for an in-flight stroke', () => {
    const { beginStroke, cleanup } = setup();
    beginStroke('s1');
    vi.clearAllMocks();

    cleanup();
    expect(clearScribbleSuppressed).toHaveBeenCalledWith('ink:s1');
  });

  it('cleanup with nothing active does nothing', () => {
    const { cleanup } = setup();
    cleanup();
    expect(clearScribbleSuppressed).not.toHaveBeenCalled();
  });

  it('cleanup after a normal endStroke clears nothing further', () => {
    const { beginStroke, endStroke, cleanup } = setup();
    beginStroke('s1');
    endStroke('s1');
    vi.clearAllMocks();

    cleanup();
    expect(clearScribbleSuppressed).not.toHaveBeenCalled();
  });
});
