(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.ExpenseBackupService = api.createExpenseBackupService({
      createDatabaseSnapshot: root.createDatabaseSnapshot,
      replaceDatabaseSnapshot: root.replaceDatabaseSnapshot,
      applyBackupMergePlan: root.applyBackupMergePlan,
      backupUtils: root.ExpenseBackupUtils,
      backupCrypto: root.ExpenseBackupCrypto,
      getSettings: root.getSettings,
      setSettings: root.setSettings,
      fileHandles: root.ExpenseBackupFileHandles,
      showSaveFilePicker: typeof root.showSaveFilePicker === 'function'
        ? root.showSaveFilePicker.bind(root)
        : null,
      navigator: root.navigator,
      document: root.document,
      Blob: root.Blob,
      URL: root.URL,
      setTimeout: root.setTimeout && root.setTimeout.bind(root),
      clearTimeout: root.clearTimeout && root.clearTimeout.bind(root),
      console: root.console,
      databaseVersion: 2
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const BACKUP_META_KEY = 'backupMeta';
  const AUTOMATIC_BACKUP_DELAY = 1500;
  const DEFAULT_BACKUP_META = Object.freeze({
    lastBackupAt: null,
    lastBackupExpenseCount: 0,
    newExpenseCount: 0,
    snoozedUntil: null,
    automaticFileStatus: 'not-configured',
    persistentStorage: 'unknown'
  });

  function asError(error) {
    return error instanceof Error ? error : new Error(String(error));
  }

  function normalizedRecord(value) {
    if (Array.isArray(value)) return value.map(normalizedRecord);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((normalized, key) => {
      normalized[key] = normalizedRecord(value[key]);
      return normalized;
    }, Object.create(null));
  }

  function recordsEqual(left, right) {
    return JSON.stringify(normalizedRecord(left))
      === JSON.stringify(normalizedRecord(right));
  }

  function createExpenseBackupService(deps = {}) {
    const now = typeof deps.now === 'function' ? deps.now : () => new Date();
    const setTimer = deps.setTimeout || (
      typeof setTimeout === 'function' ? setTimeout : null
    );
    const clearTimer = deps.clearTimeout || (
      typeof clearTimeout === 'function' ? clearTimeout : null
    );
    const scheduleCleanup = deps.scheduleCleanup || setTimer;
    let automaticBackupTimer = null;
    let automaticBackupRunning = false;
    let automaticBackupDirty = false;
    let automaticWriteTail = Promise.resolve();
    let service;

    function reportAutomaticBackupResult(result) {
      try {
        if (typeof deps.onAutomaticBackupResult === 'function') {
          deps.onAutomaticBackupResult(result);
          return;
        }
        const logger = deps.console || (
          typeof console !== 'undefined' ? console : null
        );
        if ((!result || result.written === false || result.ok === false)
          && logger
          && typeof logger.warn === 'function') {
          logger.warn('Automatic backup did not complete successfully', result);
        }
      } catch (error) {
        // Observability must not interrupt expense recording.
      }
    }

    async function getBackupMeta() {
      const stored = typeof deps.getSettings === 'function'
        ? await deps.getSettings(BACKUP_META_KEY, null)
        : null;
      return {
        ...DEFAULT_BACKUP_META,
        ...(stored && typeof stored === 'object' ? stored : {})
      };
    }

    async function setBackupMeta(changes = {}) {
      const meta = {
        ...await getBackupMeta(),
        ...(changes && typeof changes === 'object' ? changes : {})
      };
      if (typeof deps.setSettings === 'function') {
        await deps.setSettings(BACKUP_META_KEY, meta);
      }
      return meta;
    }

    function getAppVersion() {
      if (deps.appVersion !== undefined) {
        return String(deps.appVersion).replace(/^v/i, '');
      }
      const element = deps.document
        && typeof deps.document.querySelector === 'function'
        && deps.document.querySelector('.setting-version');
      return String(element && element.textContent || '').trim().replace(/^v/i, '');
    }

    async function buildCurrentBackup() {
      if (typeof deps.createDatabaseSnapshot !== 'function') {
        throw new Error('createDatabaseSnapshot is not available');
      }
      if (!deps.backupUtils
        || typeof deps.backupUtils.buildBackupEnvelope !== 'function') {
        throw new Error('ExpenseBackupUtils.buildBackupEnvelope is not available');
      }

      const snapshot = await deps.createDatabaseSnapshot();
      const databaseVersion = Number(
        snapshot && snapshot.databaseVersion
        || snapshot && snapshot.metadata && snapshot.metadata.databaseVersion
        || deps.databaseVersion
        || 2
      );
      return deps.backupUtils.buildBackupEnvelope({
        ...(snapshot || {}),
        databaseVersion,
        appVersion: getAppVersion(),
        exportedAt: now().toISOString()
      });
    }

    function downloadText(text, filename, mimeType = 'text/plain;charset=utf-8') {
      if (typeof deps.downloadText === 'function') {
        return deps.downloadText(text, filename, mimeType);
      }
      if (!deps.Blob || !deps.URL || !deps.document) {
        throw new Error('File download is not available');
      }

      const blob = new deps.Blob([text], { type: mimeType });
      const url = deps.URL.createObjectURL(blob);
      const link = deps.document.createElement('a');
      link.href = url;
      link.download = filename;
      deps.document.body.appendChild(link);
      link.click();
      link.remove();
      if (scheduleCleanup) {
        scheduleCleanup(() => deps.URL.revokeObjectURL(url), 0);
      } else {
        deps.URL.revokeObjectURL(url);
      }
    }

    async function markBackupSuccessful(backupOrExpenseCount) {
      const currentBackup = typeof backupOrExpenseCount === 'number'
        ? null
        : backupOrExpenseCount || await buildCurrentBackup();
      const expenseCount = typeof backupOrExpenseCount === 'number'
        ? backupOrExpenseCount
        : Array.isArray(currentBackup.expenses)
          ? currentBackup.expenses.length
          : 0;
      return setBackupMeta({
        lastBackupAt: now().toISOString(),
        lastBackupExpenseCount: expenseCount,
        newExpenseCount: 0,
        snoozedUntil: null
      });
    }

    async function parseBackupText(text, password) {
      let parsed;
      try {
        parsed = JSON.parse(String(text));
      } catch (error) {
        throw new Error('备份文件不是有效 JSON');
      }

      const encrypted = Boolean(
        deps.backupCrypto
        && typeof deps.backupCrypto.isEncryptedBackup === 'function'
        && deps.backupCrypto.isEncryptedBackup(parsed)
      );
      if (encrypted && (typeof password !== 'string' || password.length === 0)) {
        return { encrypted: true, requiresPassword: true };
      }

      if (encrypted) {
        try {
          if (typeof deps.backupCrypto.decryptBackup !== 'function') {
            throw new Error('decrypt unavailable');
          }
          const decryptedText = await deps.backupCrypto.decryptBackup(parsed, password);
          parsed = JSON.parse(decryptedText);
        } catch (error) {
          throw new Error('密码错误或加密备份已损坏');
        }
      }

      if (!deps.backupUtils
        || typeof deps.backupUtils.validateBackupEnvelope !== 'function') {
        throw new Error('ExpenseBackupUtils.validateBackupEnvelope is not available');
      }
      const validation = deps.backupUtils.validateBackupEnvelope(parsed);
      if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
      }
      return {
        encrypted,
        requiresPassword: false,
        backup: parsed
      };
    }

    async function inspectBackupFile(file, password) {
      if (!file || typeof file.text !== 'function') {
        throw new Error('Backup file is not readable');
      }
      const parsed = await parseBackupText(await file.text(), password);
      if (parsed.requiresPassword) return parsed;
      if (typeof deps.createDatabaseSnapshot !== 'function') {
        throw new Error('createDatabaseSnapshot is not available');
      }
      if (!deps.backupUtils
        || typeof deps.backupUtils.createRestoreSummary !== 'function') {
        throw new Error('ExpenseBackupUtils.createRestoreSummary is not available');
      }
      const current = await deps.createDatabaseSnapshot();
      return {
        ...parsed,
        summary: deps.backupUtils.createRestoreSummary(current, parsed.backup)
      };
    }

    function validateRestoredSnapshot(snapshot, expectations = {}) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Restored database snapshot must be an object');
      }
      ['expenses', 'tags', 'tagGroups', 'settings'].forEach(key => {
        if (!Array.isArray(snapshot[key])) {
          throw new Error(`Restored database ${key} must be an array`);
        }
      });

      Object.entries(expectations.counts || {}).forEach(([key, count]) => {
        const actual = snapshot[key].length;
        const valid = expectations.exactCounts
          ? actual === count
          : actual >= count;
        if (!valid) {
          throw new Error(`Restored database ${key} count is invalid`);
        }
      });

      const groupIds = new Set(
        snapshot.tagGroups.filter(group => group && group.id).map(group => group.id)
      );
      snapshot.tags.forEach(tag => {
        if (tag && tag.parentId && !groupIds.has(tag.parentId)) {
          throw new Error(
            `Restored tag ${tag.id || '(unknown)'} has a missing parent reference`
          );
        }
      });

      for (const conflict of expectations.conflicts || []) {
        const current = conflict && conflict.current;
        if (!current || !current.id) continue;
        const collections = ['expenses', 'tags', 'tagGroups'];
        const restored = collections
          .map(key => snapshot[key].find(item => item && item.id === current.id))
          .find(Boolean);
        if (!restored || !recordsEqual(restored, current)) {
          throw new Error(`Merge conflict ${current.id} did not preserve current data`);
        }
      }
    }

    async function restoreBackup(backup, mode) {
      if (!deps.backupUtils
        || typeof deps.backupUtils.validateBackupEnvelope !== 'function') {
        throw new Error('ExpenseBackupUtils.validateBackupEnvelope is not available');
      }
      const validation = deps.backupUtils.validateBackupEnvelope(backup);
      if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
      }
      if (mode !== 'replace' && mode !== 'merge') {
        throw new Error(`Unknown restore mode: ${mode}`);
      }
      if (typeof deps.createDatabaseSnapshot !== 'function') {
        throw new Error('createDatabaseSnapshot is not available');
      }
      if (typeof deps.replaceDatabaseSnapshot !== 'function') {
        throw new Error('replaceDatabaseSnapshot is not available');
      }
      if (mode === 'merge'
        && typeof deps.applyBackupMergePlan !== 'function') {
        throw new Error('applyBackupMergePlan is not available');
      }
      if (typeof deps.backupUtils.planBackupMerge !== 'function'
        || typeof deps.backupUtils.createRestoreSummary !== 'function') {
        throw new Error('ExpenseBackupUtils restore helpers are not available');
      }

      const safetySnapshot = await deps.createDatabaseSnapshot();
      const summary = deps.backupUtils.createRestoreSummary(
        safetySnapshot,
        backup
      );
      const mergePlan = mode === 'merge'
        ? deps.backupUtils.planBackupMerge(safetySnapshot, backup)
        : null;
      let restoredSnapshot;

      try {
        if (mode === 'replace') {
          await deps.replaceDatabaseSnapshot(backup);
        } else {
          await deps.applyBackupMergePlan(mergePlan);
        }

        restoredSnapshot = await deps.createDatabaseSnapshot();
        validateRestoredSnapshot(restoredSnapshot, mode === 'replace'
          ? {
            exactCounts: true,
            counts: {
              expenses: backup.expenses.length,
              tags: backup.tags.length,
              settings: backup.settings.length
            }
          }
          : {
            exactCounts: false,
            counts: {
              expenses: safetySnapshot.expenses.length
                + mergePlan.expensesToAdd.length,
              tags: safetySnapshot.tags.length + mergePlan.tagsToAdd.length,
              tagGroups: safetySnapshot.tagGroups.length
                + mergePlan.tagGroupsToAdd.length,
              settings: safetySnapshot.settings.length
            },
            conflicts: mergePlan.conflicts
          });
        if (mode === 'replace'
          && restoredSnapshot.tagGroups.length < backup.tagGroups.length) {
          throw new Error('Restored database tagGroups count is invalid');
        }
      } catch (error) {
        const restoreError = asError(error);
        try {
          await deps.replaceDatabaseSnapshot(safetySnapshot);
        } catch (rollbackError) {
          const rollbackFailure = asError(rollbackError);
          throw new Error(
            `Restore failed: ${restoreError.message}; rollback failed: ${rollbackFailure.message}`
          );
        }
        throw restoreError;
      }

      let metadataWarning = null;
      try {
        await markBackupSuccessful(restoredSnapshot.expenses.length);
      } catch (error) {
        metadataWarning = asError(error);
      }
      return {
        restored: true,
        mode,
        snapshot: restoredSnapshot,
        summary,
        ...(metadataWarning ? { metadataWarning } : {})
      };
    }

    function backupFilename(suffix) {
      return `expense-tracker-backup-${now().toISOString().slice(0, 10)}${suffix}`;
    }

    async function downloadPlainBackup() {
      const backup = await buildCurrentBackup();
      await Promise.resolve(downloadText(
        JSON.stringify(backup, null, 2),
        backupFilename('.json'),
        'application/json;charset=utf-8'
      ));
      await markBackupSuccessful(backup);
      return backup;
    }

    async function downloadEncryptedBackup(password) {
      if (!deps.backupCrypto
        || typeof deps.backupCrypto.encryptBackup !== 'function') {
        throw new Error('ExpenseBackupCrypto.encryptBackup is not available');
      }
      const backup = await buildCurrentBackup();
      const encrypted = await deps.backupCrypto.encryptBackup(
        JSON.stringify(backup, null, 2),
        password
      );
      await Promise.resolve(downloadText(
        JSON.stringify(encrypted, null, 2),
        backupFilename('.encrypted.json'),
        'application/json;charset=utf-8'
      ));
      await markBackupSuccessful(backup);
      return encrypted;
    }

    async function updateAutomaticStatus(status) {
      try {
        await setBackupMeta({ automaticFileStatus: status });
      } catch (error) {
        return false;
      }
      return true;
    }

    async function ensureWritePermission(handle, options = {}) {
      if (!handle || typeof handle.queryPermission !== 'function') {
        return 'denied';
      }
      const permissionOptions = { mode: 'readwrite' };
      const current = await handle.queryPermission(permissionOptions);
      if (current === 'granted') return current;
      if (!options.requestPermission
        || typeof handle.requestPermission !== 'function') {
        return current;
      }
      return handle.requestPermission(permissionOptions);
    }

    async function performAutomaticBackupWrite(options = {}) {
      let backup;
      try {
        const handle = options.handle || (
          deps.fileHandles && typeof deps.fileHandles.get === 'function'
            ? await deps.fileHandles.get()
            : null
        );
        if (!handle) {
          await updateAutomaticStatus('not-configured');
          return { ok: false, status: 'not-configured', written: false };
        }

        const permission = await ensureWritePermission(handle, {
          requestPermission: options.requestPermission === true
        });
        if (permission !== 'granted') {
          const status = permission === 'denied'
            ? 'permission-denied'
            : 'permission-required';
          await updateAutomaticStatus(status);
          return { ok: false, status, written: false };
        }

        backup = await buildCurrentBackup();
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(backup, null, 2));
        await writable.close();
      } catch (error) {
        const normalizedError = asError(error);
        await updateAutomaticStatus('write-error');
        return {
          ok: false,
          status: 'write-error',
          written: false,
          error: normalizedError
        };
      }

      let metadataWarning = null;
      try {
        await markBackupSuccessful(backup);
        await setBackupMeta({ automaticFileStatus: 'ready' });
      } catch (error) {
        metadataWarning = asError(error);
      }
      return {
        ok: true,
        status: 'ready',
        written: true,
        ...(metadataWarning ? { metadataWarning } : {})
      };
    }

    function writeAutomaticBackup(options = {}) {
      const queuedWrite = automaticWriteTail.then(
        () => performAutomaticBackupWrite(options)
      );
      automaticWriteTail = queuedWrite.catch(() => undefined);
      return queuedWrite;
    }

    async function recordPersistentStorageStatus(status) {
      try {
        await setBackupMeta({ persistentStorage: status });
        return null;
      } catch (error) {
        return asError(error);
      }
    }

    async function chooseAutomaticBackupFile() {
      if (typeof deps.showSaveFilePicker !== 'function') {
        await updateAutomaticStatus('unsupported');
        return { supported: false };
      }

      try {
        const handle = await deps.showSaveFilePicker({
          suggestedName: 'expense-tracker-automatic-backup.json',
          types: [{
            description: 'Expense Tracker JSON backup',
            accept: { 'application/json': ['.json'] }
          }]
        });
        if (deps.fileHandles && typeof deps.fileHandles.save === 'function') {
          await deps.fileHandles.save(handle);
        }
        await updateAutomaticStatus('ready');
        const writeResult = await writeAutomaticBackup({
          requestPermission: true,
          handle
        });
        return { supported: true, handle, ...writeResult };
      } catch (error) {
        const normalizedError = asError(error);
        const status = normalizedError.name === 'AbortError'
          ? 'selection-cancelled'
          : 'write-error';
        await updateAutomaticStatus(status);
        return {
          supported: true,
          ok: false,
          status,
          error: normalizedError
        };
      }
    }

    async function runScheduledAutomaticBackups() {
      if (automaticBackupRunning) {
        automaticBackupDirty = true;
        return;
      }
      automaticBackupRunning = true;
      try {
        do {
          automaticBackupDirty = false;
          let result;
          try {
            result = await service.writeAutomaticBackup();
          } catch (error) {
            result = {
              ok: false,
              written: false,
              status: 'unexpected-error',
              error: asError(error)
            };
          }
          reportAutomaticBackupResult(result);
        } while (automaticBackupDirty);
      } finally {
        automaticBackupRunning = false;
      }
    }

    function scheduleAutomaticBackup() {
      if (automaticBackupRunning) {
        automaticBackupDirty = true;
        return automaticBackupTimer;
      }
      if (!setTimer) return null;
      if (automaticBackupTimer !== null && clearTimer) {
        clearTimer(automaticBackupTimer);
      }
      automaticBackupTimer = setTimer(() => {
        automaticBackupTimer = null;
        try {
          return runScheduledAutomaticBackups();
        } catch (error) {
          reportAutomaticBackupResult({
            ok: false,
            written: false,
            status: 'unexpected-error',
            error: asError(error)
          });
          return undefined;
        }
      }, AUTOMATIC_BACKUP_DELAY);
      return automaticBackupTimer;
    }

    async function requestPersistentStorage() {
      const storage = deps.navigator && deps.navigator.storage;
      if (!storage || typeof storage.persist !== 'function') {
        const metadataWarning = await recordPersistentStorageStatus('unsupported');
        return {
          ok: false,
          status: 'unsupported',
          ...(metadataWarning ? { metadataWarning } : {})
        };
      }

      let granted;
      try {
        granted = await storage.persist();
      } catch (error) {
        const normalizedError = asError(error);
        const metadataWarning = await recordPersistentStorageStatus('denied');
        return {
          ok: false,
          status: 'denied',
          error: normalizedError,
          ...(metadataWarning ? { metadataWarning } : {})
        };
      }
      const status = granted ? 'granted' : 'denied';
      const metadataWarning = await recordPersistentStorageStatus(status);
      return {
        ok: granted,
        status,
        ...(metadataWarning ? { metadataWarning } : {})
      };
    }

    service = {
      getBackupMeta,
      setBackupMeta,
      buildCurrentBackup,
      downloadText,
      downloadPlainBackup,
      downloadEncryptedBackup,
      markBackupSuccessful,
      parseBackupText,
      inspectBackupFile,
      restoreBackup,
      chooseAutomaticBackupFile,
      ensureWritePermission,
      writeAutomaticBackup,
      scheduleAutomaticBackup,
      requestPersistentStorage
    };
    return service;
  }

  return {
    BACKUP_META_KEY,
    AUTOMATIC_BACKUP_DELAY,
    DEFAULT_BACKUP_META,
    createExpenseBackupService
  };
});
