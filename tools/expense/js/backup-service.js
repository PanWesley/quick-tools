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
    let automaticBackupTimer = null;
    let service;

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
      link.click();
      deps.URL.revokeObjectURL(url);
    }

    async function markBackupSuccessful(backup) {
      const currentBackup = backup || await buildCurrentBackup();
      return setBackupMeta({
        lastBackupAt: now().toISOString(),
        lastBackupExpenseCount: Array.isArray(currentBackup.expenses)
          ? currentBackup.expenses.length
          : 0,
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
      try {
        const handle = options.handle || (
          deps.fileHandles && typeof deps.fileHandles.get === 'function'
            ? await deps.fileHandles.get()
            : null
        );
        if (!handle) {
          await updateAutomaticStatus('not-configured');
          return { ok: false, status: 'not-configured' };
        }

        const permission = await ensureWritePermission(handle, {
          requestPermission: options.requestPermission === true
        });
        if (permission !== 'granted') {
          const status = permission === 'denied'
            ? 'permission-denied'
            : 'permission-required';
          await updateAutomaticStatus(status);
          return { ok: false, status };
        }

        const backup = await buildCurrentBackup();
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(backup, null, 2));
        await writable.close();
        await markBackupSuccessful(backup);
        await updateAutomaticStatus('ready');
        return { ok: true, status: 'ready' };
      } catch (error) {
        const normalizedError = asError(error);
        await updateAutomaticStatus('write-error');
        return { ok: false, status: 'write-error', error: normalizedError };
      }
    }

    async function chooseAutomaticBackupFile() {
      if (typeof deps.showSaveFilePicker !== 'function') {
        await updateAutomaticStatus('unsupported');
        return { ok: false, status: 'unsupported' };
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
        return writeAutomaticBackup({ requestPermission: true, handle });
      } catch (error) {
        const normalizedError = asError(error);
        const status = normalizedError.name === 'AbortError'
          ? 'selection-cancelled'
          : 'write-error';
        await updateAutomaticStatus(status);
        return { ok: false, status, error: normalizedError };
      }
    }

    function scheduleAutomaticBackup() {
      if (!setTimer) return null;
      if (automaticBackupTimer !== null && clearTimer) {
        clearTimer(automaticBackupTimer);
      }
      automaticBackupTimer = setTimer(async () => {
        automaticBackupTimer = null;
        try {
          await service.writeAutomaticBackup();
        } catch (error) {
          // Automatic backup must never interrupt expense recording.
        }
      }, AUTOMATIC_BACKUP_DELAY);
      return automaticBackupTimer;
    }

    async function requestPersistentStorage() {
      const storage = deps.navigator && deps.navigator.storage;
      if (!storage || typeof storage.persist !== 'function') {
        try {
          await setBackupMeta({ persistentStorage: 'unsupported' });
        } catch (error) {
          // Status persistence is best effort.
        }
        return { ok: false, status: 'unsupported' };
      }

      try {
        const granted = await storage.persist();
        const status = granted ? 'granted' : 'denied';
        await setBackupMeta({ persistentStorage: status });
        return { ok: granted, status };
      } catch (error) {
        const normalizedError = asError(error);
        try {
          await setBackupMeta({ persistentStorage: 'denied' });
        } catch (statusError) {
          // Status persistence is best effort.
        }
        return { ok: false, status: 'denied', error: normalizedError };
      }
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
