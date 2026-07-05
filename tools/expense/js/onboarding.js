(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.BillNestOnboarding = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const SETTING_SHOW_ON_START = 'onboarding_show_on_start';
  const SETTING_SEEN = 'onboarding_seen';

  function shouldShowOnboarding(options = {}) {
    const initialView = options.initialView || 'add';
    if (initialView !== 'add') return false;
    if (options.showOnStart === true) return true;
    return !options.seen && Number(options.expenseCount || 0) === 0;
  }

  function buildOnboardingSettingsState(options = {}) {
    const showOnStart = options.showOnStart === true;
    return {
      seen: options.seen === true,
      showOnStart,
      checked: showOnStart
    };
  }

  return {
    SETTING_SHOW_ON_START,
    SETTING_SEEN,
    shouldShowOnboarding,
    buildOnboardingSettingsState
  };
});
