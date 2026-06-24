(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExpenseBackupUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const BACKUP_FORMAT_VERSION = 1;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function buildBackupEnvelope(input = {}) {
    return {
      formatVersion: BACKUP_FORMAT_VERSION,
      databaseVersion: Number(input.databaseVersion || 0),
      appVersion: String(input.appVersion || ''),
      exportedAt: input.exportedAt || new Date().toISOString(),
      expenses: asArray(input.expenses),
      tags: asArray(input.tags),
      tagGroups: asArray(input.tagGroups),
      settings: asArray(input.settings),
      recurringRules: asArray(input.recurringRules),
      pendingExpenses: asArray(input.pendingExpenses),
      budgets: asArray(input.budgets)
    };
  }

  function validateBackupEnvelope(data) {
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { valid: false, errors: ['Backup must be an object'] };
    }

    if (!Number.isInteger(data.formatVersion)) {
      errors.push('Backup format version is required');
    } else if (data.formatVersion > BACKUP_FORMAT_VERSION) {
      errors.push('Backup was created by a newer app version');
    }

    ['expenses', 'tags', 'tagGroups', 'settings'].forEach(key => {
      if (!Array.isArray(data[key])) errors.push(`${key} must be an array`);
    });

    if (!data.exportedAt || Number.isNaN(Date.parse(data.exportedAt))) {
      errors.push('Exported date is invalid');
    }

    asArray(data.expenses).forEach((expense, index) => {
      if (!expense || !expense.id) errors.push(`Expense ${index + 1} is missing id`);
      if (!expense || !expense.date) errors.push(`Expense ${index + 1} is missing date`);
      if (!expense || !Number.isFinite(Number(expense.amount))) {
        errors.push(`Expense ${index + 1} has an invalid amount`);
      }
    });

    return { valid: errors.length === 0, errors };
  }

  function shouldRemindBackup(input = {}) {
    const now = Date.parse(input.now || new Date().toISOString());
    const snoozedUntil = input.snoozedUntil ? Date.parse(input.snoozedUntil) : 0;
    const newExpenseCount = Number(input.newExpenseCount || 0);

    if (snoozedUntil > now) return { remind: false, reason: null };
    if (!input.lastBackupAt) return { remind: newExpenseCount > 0, reason: 'never' };
    if (now - Date.parse(input.lastBackupAt) >= 14 * DAY_MS) {
      return { remind: true, reason: 'age' };
    }
    if (newExpenseCount >= 30) return { remind: true, reason: 'count' };
    return { remind: false, reason: null };
  }

  function normalizeText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function createExpenseFingerprint(expense = {}) {
    return JSON.stringify([
      String(expense.date || '').slice(0, 10),
      Number(expense.amount || 0).toFixed(2),
      normalizeText(expense.note || expense.itemName),
      asArray(expense.tags).map(String).sort()
    ]);
  }

  function equalRecord(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function additionsAndConflicts(current, incoming, fingerprint) {
    const currentById = new Map(
      current.filter(item => item && item.id).map(item => [item.id, item])
    );
    const fingerprints = new Set(current.map(fingerprint));
    const toAdd = [];
    const conflicts = [];

    for (const item of incoming) {
      if (item && item.id && currentById.has(item.id)) {
        const currentItem = currentById.get(item.id);
        if (!equalRecord(currentItem, item)) conflicts.push({ current: currentItem, incoming: item });
        continue;
      }

      const itemFingerprint = fingerprint(item);
      if (fingerprints.has(itemFingerprint)) continue;
      toAdd.push(item);
      fingerprints.add(itemFingerprint);
    }

    return { toAdd, conflicts };
  }

  function idFingerprint(item) {
    return String(item && (item.id || item.key) || JSON.stringify(item));
  }

  function planBackupMerge(current = {}, incoming = {}) {
    const expenses = additionsAndConflicts(
      asArray(current.expenses),
      asArray(incoming.expenses),
      createExpenseFingerprint
    );
    const tags = additionsAndConflicts(
      asArray(current.tags),
      asArray(incoming.tags),
      idFingerprint
    );
    const groups = additionsAndConflicts(
      asArray(current.tagGroups),
      asArray(incoming.tagGroups),
      idFingerprint
    );

    return {
      expensesToAdd: expenses.toAdd,
      tagsToAdd: tags.toAdd,
      tagGroupsToAdd: groups.toAdd,
      conflicts: [...expenses.conflicts, ...tags.conflicts, ...groups.conflicts]
    };
  }

  return {
    BACKUP_FORMAT_VERSION,
    buildBackupEnvelope,
    validateBackupEnvelope,
    shouldRemindBackup,
    createExpenseFingerprint,
    planBackupMerge
  };
});
