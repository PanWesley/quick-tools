const assert = require('assert');
const onboarding = require('./onboarding');

assert.strictEqual(onboarding.SETTING_SHOW_ON_START, 'onboarding_show_on_start');
assert.strictEqual(onboarding.SETTING_SEEN, 'onboarding_seen');

assert.strictEqual(
  onboarding.shouldShowOnboarding({
    initialView: 'add',
    expenseCount: 0,
    seen: false,
    showOnStart: false
  }),
  true,
  'empty first launch should show the onboarding screen'
);

assert.strictEqual(
  onboarding.shouldShowOnboarding({
    initialView: 'add',
    expenseCount: 12,
    seen: false,
    showOnStart: false
  }),
  false,
  'existing users should not be interrupted by onboarding automatically'
);

assert.strictEqual(
  onboarding.shouldShowOnboarding({
    initialView: 'add',
    expenseCount: 12,
    seen: true,
    showOnStart: true
  }),
  true,
  'the settings toggle should allow users to show onboarding at startup'
);

assert.strictEqual(
  onboarding.shouldShowOnboarding({
    initialView: 'add',
    expenseCount: 0,
    seen: true,
    showOnStart: false
  }),
  false,
  'dismissing onboarding should suppress future automatic startup display'
);

assert.strictEqual(
  onboarding.shouldShowOnboarding({
    initialView: 'dashboard',
    expenseCount: 0,
    seen: false,
    showOnStart: true
  }),
  false,
  'explicit hash routes should not be stolen by onboarding'
);

assert.deepStrictEqual(
  onboarding.buildOnboardingSettingsState({ seen: false, showOnStart: null }),
  { seen: false, showOnStart: false, checked: false }
);

assert.deepStrictEqual(
  onboarding.buildOnboardingSettingsState({ seen: true, showOnStart: true }),
  { seen: true, showOnStart: true, checked: true }
);

console.log('onboarding helper tests passed');
