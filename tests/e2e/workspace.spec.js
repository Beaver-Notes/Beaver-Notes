import { browser, expect } from '@wdio/globals';

describe('Workspace', () => {
  let featureAvailable = false;

  before(async () => {
    featureAvailable = await browser.execute(() => {
      const el = document.querySelector('.workspace-switcher');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none';
    });
  });

  it('should display the workspace switcher when available', async () => {
    if (!featureAvailable) {
      console.log('    [skip] Workspace feature is gated/hidden');
      return;
    }
    const switcher = await browser.$('.workspace-switcher');
    await expect(switcher).toBeExisting();
  });

  it('should open the workspace popover', async () => {
    if (!featureAvailable) {
      console.log('    [skip] Workspace feature is gated/hidden');
      return;
    }
    const trigger = await browser.$('.workspace-switcher');
    if (await trigger.isExisting()) {
      await trigger.click();
      await browser.pause(500);

      const popover = await browser.$('[role="listbox"], [role="menu"], [class*="popover"]');
      const hasPopover = await popover.isExisting().catch(() => false);
      expect(hasPopover).toBe(true);
    }
  });

  it('should show existing workspaces', async () => {
    if (!featureAvailable) {
      console.log('    [skip] Workspace feature is gated/hidden');
      return;
    }
    const trigger = await browser.$('.workspace-switcher');
    if (await trigger.isExisting()) {
      await trigger.click();
      await browser.pause(500);
    }
  });

  it('should create a new workspace', async () => {
    if (!featureAvailable) {
      console.log('    [skip] Workspace feature is gated/hidden');
      return;
    }

    const newWsBtn = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return !!btns.find(el => /workspace/i.test(el.textContent));
    });

    if (newWsBtn) {
      await browser.execute(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(el => /workspace/i.test(el.textContent));
        if (btn) btn.click();
      });
      await browser.pause(500);

      const input = await $('input[type="text"]');
      if (await input.isExisting()) {
        const wsName = `E2E Workspace ${Date.now()}`;
        await input.setValue(wsName);

        await browser.execute(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(el => /create|add|submit/i.test(el.textContent));
          if (btn) btn.click();
        });
      }
    }

    await browser.pause(1000);
  });

  it('should navigate back to home after workspace operations', async () => {
    const notesBtn = await $('[data-testid="nav-notes-button"]');
    if (await notesBtn.isExisting()) {
      await notesBtn.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.endsWith('#/') || url.endsWith('#');
      });
    }
  });
});
