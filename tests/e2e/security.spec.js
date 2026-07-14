import { browser, expect } from '@wdio/globals';
import { navigateToSecurity, navigateToNotes } from './helpers.js';

describe('Security', () => {
  it('should display security settings page', async () => {
    await navigateToSecurity();
    await browser.pause(500);

    const hasSection = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.some(el =>
        el.textContent.includes('Security') && el.offsetParent !== null
      );
    });

    expect(hasSection).toBe(true);
  });

  it('should show password input when no password set', async () => {
    await browser.pause(500);

    const passwordInput = await browser.execute(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="password"]'));
      return inputs.some(input => input.offsetParent !== null);
    });

    const hasChangeBtn = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('Change') && b.offsetParent !== null);
    });

    expect(passwordInput || hasChangeBtn).toBe(true);
  });

  it('should display encryption status', async () => {
    await browser.pause(500);

    const hasEncryption = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.some(el =>
        el.textContent.includes('Always on') && el.offsetParent !== null
      );
    });

    expect(hasEncryption).toBe(true);
  });

  it('should show lock now button', async () => {
    await browser.pause(500);

    const hasLockBtn = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('Lock Now') && b.offsetParent !== null);
    });

    expect(hasLockBtn).toBe(true);
  });

  it('should show change passphrase option', async () => {
    await browser.pause(500);

    const hasChangePassphrase = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('Change Passphrase') && b.offsetParent !== null);
    });

    expect(hasChangePassphrase).toBe(true);
  });

  it('should navigate back to home from security', async () => {
    await navigateToNotes();
    const url = await browser.getUrl();
    expect(url).not.toContain('security');
  });
});
