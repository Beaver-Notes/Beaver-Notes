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
  it('handles IAP purchase async with busy + processing feedback', () => {
    const src = readFileSync('src/pages/settings/Account.vue', 'utf8');
    expect(src).toMatch(/handleIapSelect/);
    expect(src).toMatch(/iapBusy/);
    expect(src).toMatch(/await iap\.buy\(/);
    expect(src).toMatch(/Payment processing — your plan will activate shortly/);
  });
  it('wires restore purchases through iap.restore', () => {
    const src = readFileSync('src/pages/settings/Account.vue', 'utf8');
    expect(src).toMatch(/handleIapRestore/);
    expect(src).toMatch(/await iap\.restore\(\)/);
    expect(src).toMatch(/@restore/);
  });
});
