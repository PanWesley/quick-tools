(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.ExpenseBackupService = api.createExpenseBackupService({
      createDatabaseSnapshot: root.createDatabaseSnapshot,
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

    async function writeAutomaticBackup(options = {}) {
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
