import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Account mobile billing wiring', () => {
  it('routes upgrades through SubscriptionDialog on mobile', () => {
    const src = readFileSync('src/pages/settings/Account.vue', 'utf8');
    expect(src).toMatch(/SubscriptionDialog/);
    expect(src).toMatch(/showPlansDialog/);
  });
  it('hides team rows on mobile', () => {
    const src = readFileSync('src/pages/settings/Account.vue', 'utf8');
    expect(src).toMatch(/opt\.plan !== 'team'/);
  });
});
