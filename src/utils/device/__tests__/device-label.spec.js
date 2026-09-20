import { describe, expect, it } from 'vitest';
import { deviceDisplayName, devicePlatform } from '@/utils/device/device-label';

describe('device labels', () => {
  it('never falls back to the raw device id as a name', () => {
    expect(deviceDisplayName({ deviceId: 'a1b2c3-uuid' })).toBe('Unknown device');
    expect(deviceDisplayName({ deviceLabel: 'MacBook Pro' })).toBe('MacBook Pro');
  });

  it('detects platform from session deviceInfo', () => {
    expect(devicePlatform({ deviceInfo: { platform: 'mobile' } })).toBe('mobile');
    expect(devicePlatform({ deviceInfo: { platform: 'desktop' } })).toBe('desktop');
    expect(devicePlatform({ label: 'iPad Air' })).toBe('tablet');
    expect(devicePlatform({ userAgent: 'Mozilla/5.0 (iPhone)' })).toBe('mobile');
  });
});
