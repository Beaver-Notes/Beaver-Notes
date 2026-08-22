import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  isPhoneRuntime: vi.fn(),
  isMobileRuntime: vi.fn(),
  selectionFeedback: vi.fn(),
  impactFeedback: vi.fn(),
  notificationFeedback: vi.fn(),
}));

vi.mock('@/lib/tauri/runtime', () => ({
  isPhoneRuntime: mocks.isPhoneRuntime,
  isMobileRuntime: mocks.isMobileRuntime,
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-haptics', () => ({
  selectionFeedback: mocks.selectionFeedback,
  impactFeedback: mocks.impactFeedback,
  notificationFeedback: mocks.notificationFeedback,
}));

let triggerSelectionHaptic;
let triggerInteractionHaptic;

describe('haptics gating', () => {
  beforeEach(async () => {
    mocks.isPhoneRuntime.mockReset();
    mocks.isMobileRuntime.mockReset();
    mocks.selectionFeedback.mockReset();
    mocks.impactFeedback.mockReset();
    mocks.notificationFeedback.mockReset();
    vi.resetModules();
    ({ triggerSelectionHaptic, triggerInteractionHaptic } = await import(
      '../haptics.js'
    ));
  });

  it('consults isPhoneRuntime (not isMobileRuntime) as the gate', async () => {
    mocks.isPhoneRuntime.mockReturnValue(true);
    await triggerSelectionHaptic();
    await triggerInteractionHaptic('noteCreate');
    expect(mocks.isPhoneRuntime).toHaveBeenCalled();
    expect(mocks.isMobileRuntime).not.toHaveBeenCalled();
  });

  it('does not fire on an iPad (mobile but not phone) and does not crash', async () => {
    mocks.isMobileRuntime.mockReturnValue(true);
    mocks.isPhoneRuntime.mockReturnValue(false);
    await triggerSelectionHaptic();
    await triggerInteractionHaptic('noteCreate');
    expect(mocks.selectionFeedback).not.toHaveBeenCalled();
    expect(mocks.impactFeedback).not.toHaveBeenCalled();
    expect(mocks.isPhoneRuntime).toHaveBeenCalled();
  });

  it('fires haptics on a phone runtime', async () => {
    mocks.isPhoneRuntime.mockReturnValue(true);
    mocks.selectionFeedback.mockResolvedValue(undefined);
    mocks.impactFeedback.mockResolvedValue(undefined);
    await triggerSelectionHaptic();
    await triggerInteractionHaptic('noteCreate');
    expect(mocks.selectionFeedback).toHaveBeenCalledTimes(1);
    expect(mocks.impactFeedback).toHaveBeenCalledWith('light');
  });
});
