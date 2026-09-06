import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('onboarding plans step', () => {
  it('registers plans after account in flow and wizard steps', () => {
    const src = readFileSync('src/composable/useOnboardingFlow.js', 'utf8');
    expect(src).toMatch(/'account',\s*'plans'/);
    expect(src).toMatch(/WIZARD_STEPS = \[[^\]]*'plans'[^\]]*\]/);
  });
  it('Onboarding renders the plans template', () => {
    const vue = readFileSync('src/pages/Onboarding.vue', 'utf8');
    expect(vue).toMatch(/step === 'plans'/);
    expect(vue).toMatch(/SubscriptionPlans/);
  });
});
