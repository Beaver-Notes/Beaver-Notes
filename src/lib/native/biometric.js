import { checkStatus, authenticate } from '@choochmeque/tauri-plugin-biometry-api';

export function isBiometricAvailable() {
  return checkStatus().then((s) => s.isAvailable).catch(() => false);
}

export function authenticateWithBiometrics(reason) {
  return authenticate(reason, { allowDeviceCredential: true });
}
