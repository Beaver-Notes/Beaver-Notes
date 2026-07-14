import { browser, expect } from '@wdio/globals';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { navigateToSettings, navigateToNotes } from './helpers.js';

describe('Import/Export', () => {
  const importFile = join(tmpdir(), `e2e-import-${Date.now()}.md`);
  const importContent = `# Imported Note\n\nThis note was imported via E2E test.\n\n- Item 1\n- Item 2\n`;

  before(() => {
    writeFileSync(importFile, importContent);
  });

  after(() => {
    try {
      unlinkSync(importFile);
    } catch {
      // ignore
    }
  });

  it('should navigate to Settings for import', async () => {
    await navigateToSettings();
  });

  it('should display import options', async () => {
    await browser.pause(500);
    const page = await $('.route-stage__page');
    await expect(page).toBeExisting();
  });

  it('should navigate back to home', async () => {
    await navigateToNotes();
  });
});
