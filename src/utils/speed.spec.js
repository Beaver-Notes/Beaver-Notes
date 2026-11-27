import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { speed } from '@/utils/speed.js';
import { initPerfRecorder } from '@/lib/perf/recorder';

beforeAll(() => {
  // The app boots the recorder in src/index.js; tests bootstrap it here.
  initPerfRecorder();
});

afterEach(() => {
  window.__BEAVER_SPEED_LOG__ = false;
  window.__beaverPerf?.clear?.();
});

describe('speed logging helper', () => {
  it('always returns a timer: durations feed the perf recorder', () => {
    window.__BEAVER_SPEED_LOG__ = false;
    const t = speed('test');
    expect(t).toBeDefined();
    expect(t).toHaveProperty('end');
    t.end();
  });

  it('records the duration as a recorder span', () => {
    const t = speed('my_op');
    t.end();
    const spans = window.__beaverPerf
      ?.summary()
      .spans.filter((s) => s.label === 'speed:my_op');
    expect(spans?.length).toBe(1);
    expect(spans[0].ms).toBeGreaterThanOrEqual(0);
  });

  it('end() is safe to call twice', () => {
    const t = speed('my_op');
    expect(() => {
      t.end();
      t.end();
    }).not.toThrow();
  });

  it('logs a duration warning only when explicitly enabled', async () => {
    window.__BEAVER_SPEED_LOG__ = true;
    const warn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args);

    const t = speed('heavy_task');
    await new Promise((resolve) => setTimeout(resolve, 5));
    t.end();

    expect(calls.length).toBe(1);
    expect(calls[0][0]).toContain('[speed] heavy_task took');

    console.warn = warn;
  });

  it('suppresses sub-threshold (0ms) measures', () => {
    window.__BEAVER_SPEED_LOG__ = true;
    const warn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args);

    const t = speed('micro_task');
    t.end();

    expect(calls.length).toBe(0);

    console.warn = warn;
  });

  it('stays silent by default while still recording', () => {
    const warn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args);

    const t = speed('quiet_task');
    t.end();

    expect(calls.length).toBe(0);
    expect(
      window.__beaverPerf
        ?.summary()
        .spans.some((s) => s.label === 'speed:quiet_task'),
    ).toBe(true);

    console.warn = warn;
  });
});
