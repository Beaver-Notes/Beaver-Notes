import { describe, expect, it } from 'vitest';
import { speed } from '@/utils/speed.js';

describe('speed logging helper', () => {
  it('returns null when logging is disabled', () => {
    window.__BEAVER_SPEED_LOG__ = false;
    const t = speed('test');
    expect(t).toBeNull();
  });

  it('returns a timer object when enabled', () => {
    window.__BEAVER_SPEED_LOG__ = true;
    const t = speed('my_op');
    expect(t).toBeDefined();
    expect(t).toHaveProperty('end');
    t.end();
  });

  it('end() does not throw when called on null', () => {
    window.__BEAVER_SPEED_LOG__ = false;
    const t = speed('my_op');
    expect(() => t?.end()).not.toThrow();
  });

  it('logs a duration warning when enabled', async () => {
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
});