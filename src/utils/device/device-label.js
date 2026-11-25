// Human labels for devices and sessions. The raw device id (UUID) is an
// internal detail and must never be the primary name shown to a user.

export function deviceDisplayName(device) {
  if (!device) return 'Unknown device';
  return (
    device.label ||
    device.deviceLabel ||
    device.deviceInfo?.label ||
    device.userAgent ||
    'Unknown device'
  );
}

export function devicePlatform(device) {
  const text = [
    device?.platform,
    device?.deviceInfo?.platform,
    deviceDisplayName(device),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (text.includes('ipad') || text.includes('tablet')) return 'tablet';
  if (
    text.includes('mobile') ||
    text.includes('phone') ||
    text.includes('ios') ||
    text.includes('android')
  ) {
    return 'mobile';
  }
  return 'desktop';
}
