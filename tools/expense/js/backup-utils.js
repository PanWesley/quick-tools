(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.ExpenseBackupUtils = api;
  }
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

  function isValidAmount(value) {
    const isNumber = typeof value === 'number';
    const isNumericString = typeof value === 'string' && value.trim() !== '';
    return (isNumber || isNumericString) && Number.isFinite(Number(value));
  }

  function isValidExpenseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
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
      if (!expense || !expense.date) {
        errors.push(`Expense ${index + 1} is missing date`);
      } else if (!isValidExpenseDate(expense.date)) {
        errors.push(`Expense ${index + 1} has an invalid date`);
      }
      if (!expense || !isValidAmount(expense.amount)) {
        errors.push(`Expense ${index + 1} has an invalid amount`);
      }
    });

    return { valid: errors.length === 0, errors };
  }

  function shouldRemindBackup(input = {}) {
    const parsedNow = input.now ? Date.parse(input.now) : NaN;
    const now = Number.isFinite(parsedNow) ? parsedNow : Date.now();
    const parsedLastBackupAt = input.lastBackupAt ? Date.parse(input.lastBackupAt) : NaN;
    const lastBackupAt = Number.isFinite(parsedLastBackupAt) ? parsedLastBackupAt : null;
    const parsedSnoozedUntil = input.snoozedUntil ? Date.parse(input.snoozedUntil) : NaN;
    const snoozedUntil = Number.isFinite(parsedSnoozedUntil) ? parsedSnoozedUntil : null;
    const newExpenseCount = Number(input.newExpenseCount || 0);

    if (snoozedUntil > now) return { remind: false, reason: null };
    if (lastBackupAt === null) {
      return newExpenseCount > 0
        ? { remind: true, reason: 'never' }
        : { remind: false, reason: null };
    }
    if (now - lastBackupAt >= 14 * DAY_MS) {
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

  function normalizeRecord(value) {
    if (Array.isArray(value)) return value.map(normalizeRecord);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((normalized, key) => {
      normalized[key] = normalizeRecord(value[key]);
      return normalized;
    }, Object.create(null));
  }

  function equalRecord(a, b) {
    return JSON.stringify(normalizeRecord(a)) === JSON.stringify(normalizeRecord(b));
  }

  function additionsAndConflicts(current, incoming, fingerprint, collection) {
    const currentById = new Map(
      current.filter(item => item && item.id).map(item => [item.id, item])
    );
    const incomingById = new Map();
    const fingerprints = new Set(current.map(fingerprint));
    const toAdd = [];
    const conflicts = [];

    for (const item of incoming) {
      if (item && item.id && currentById.has(item.id)) {
        const currentItem = currentById.get(item.id);
        if (!equalRecord(currentItem, item)) {
          conflicts.push({ collection, current: currentItem, incoming: item });
        }
        continue;
      }

      if (item && item.id) {
        if (incomingById.has(item.id)) {
          const firstIncoming = incomingById.get(item.id);
          if (!equalRecord(firstIncoming, item)) {
            conflicts.push({ collection, current: firstIncoming, incoming: item });
          }
          continue;
        }
        incomingById.set(item.id, item);
        toAdd.push(item);
        fingerprints.add(fingerprint(item));
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
      createExpenseFingerprint,
      'expenses'
    );
    const tags = additionsAndConflicts(
      asArray(current.tags),
      asArray(incoming.tags),
      idFingerprint,
      'tags'
    );
    const groups = additionsAndConflicts(
      asArray(current.tagGroups),
      asArray(incoming.tagGroups),
      idFingerprint,
      'tagGroups'
    );

    return {
      expensesToAdd: expenses.toAdd,
      tagsToAdd: tags.toAdd,
      tagGroupsToAdd: groups.toAdd,
      conflicts: [...expenses.conflicts, ...tags.conflicts, ...groups.conflicts]
    };
  }

  function createRestoreSummary(current = {}, incoming = {}) {
    const plan = planBackupMerge(current, incoming);
    return {
      expenseCount: asArray(incoming.expenses).length,
      tagCount: asArray(incoming.tags).length,
      conflictCount: plan.conflicts.length,
      newExpenseCount: plan.expensesToAdd.length
    };
  }

  return {
    BACKUP_FORMAT_VERSION,
    buildBackupEnvelope,
    validateBackupEnvelope,
    shouldRemindBackup,
    createExpenseFingerprint,
    planBackupMerge,
    createRestoreSummary
  };
});
