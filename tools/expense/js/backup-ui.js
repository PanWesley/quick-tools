(function(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.ExpenseBackupUIFactory = api;
    root.ExpenseBackupUI = api.createBackupUI();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeCount(value) {
    const count = Number(value);
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  }

  function formatRelativeStatus(lastBackupAt, expenseCount, now = new Date()) {
    const parsed = Date.parse(lastBackupAt);
    if (!lastBackupAt || !Number.isFinite(parsed)) {
      return '尚未创建完整备份';
    }
    const current = now instanceof Date ? now.getTime() : Date.parse(now);
    const elapsed = Number.isFinite(current) ? Math.max(0, current - parsed) : 0;
    const days = Math.floor(elapsed / DAY_MS);
    const relative = days <= 0 ? '今天' : `${days} 天前`;
    return `${relative}已备份 · ${safeCount(expenseCount)} 笔`;
  }

  function chooseDashboardReminder(reminders) {
    const available = Array.isArray(reminders)
      ? reminders.filter(Boolean)
      : [];
    if (available.length === 0) return null;
    return available.reduce((selected, reminder) => {
      const selectedPriority = Number(selected.priority || 0);
      const reminderPriority = Number(reminder.priority || 0);
      return reminderPriority > selectedPriority ? reminder : selected;
    });
  }

  function renderReminderHtml(reminder = {}) {
    return `
      <div class="attention-card" data-reminder-id="${escapeHtml(reminder.id || 'backup')}">
        <div class="attention-copy">
          <strong>${escapeHtml(reminder.title || '建议备份账单')}</strong>
          <span>${escapeHtml(reminder.description || '一键保存完整数据，防止浏览器清理后丢失。')}</span>
        </div>
        <div class="attention-actions">
          <button class="btn-primary" type="button" onclick="ExpenseBackupUI.downloadBackup()">立即备份</button>
          <button class="btn-text" type="button" onclick="ExpenseBackupUI.snooze()">稍后</button>
        </div>
      </div>`;
  }

  function defaultDateFormatter(date) {
    const parts = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
  }

  function formatBackupDate(value, formatter = defaultDateFormatter) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return '未知日期';
    return formatter(new Date(parsed));
  }

  function renderRestoreSummaryHtml(result = {}, dateFormatter) {
    const backup = result.backup || {};
    const summary = result.summary || {};
    const version = backup.appVersion
      ? `<span>应用版本 ${escapeHtml(backup.appVersion)}</span>`
      : '';
    return `
      <div class="restore-summary">
        <strong>备份时间 ${escapeHtml(formatBackupDate(backup.exportedAt, dateFormatter))}</strong>
        ${version}
        <span>${safeCount(summary.expenseCount)} 笔账单 · ${safeCount(summary.tagCount)} 个标签</span>
        <span>${safeCount(summary.newExpenseCount)} 笔新增 · ${safeCount(summary.conflictCount)} 项冲突</span>
        <small>合并会保留当前冲突数据；覆盖会以此备份替换现有数据。</small>
      </div>`;
  }

  function createModalManager(options = {}) {
    const documentRef = options.document;
    const backgroundSelector = options.backgroundSelector || 'main, header, nav';
    let active = null;

    function getFocusables(modal) {
      if (!modal || typeof modal.querySelectorAll !== 'function') return [];
      const candidates = Array.from(modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), '
        + 'textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      ));
      return candidates.filter(candidate => {
        if (candidate.hidden || candidate.disabled) return false;
        if (typeof candidate.getClientRects === 'function') {
          return candidate.getClientRects().length > 0;
        }
        return true;
      });
    }

    function restoreBackground(records) {
      records.forEach(record => {
        record.element.inert = record.inert;
        if (record.ariaHidden === null) {
          record.element.removeAttribute('aria-hidden');
        } else {
          record.element.setAttribute('aria-hidden', record.ariaHidden);
        }
      });
    }

    function close() {
      if (!active) return;
      const current = active;
      active = null;
      current.modal.style.display = 'none';
      restoreBackground(current.background);
      if (current.previousFocus
        && typeof current.previousFocus.focus === 'function') {
        current.previousFocus.focus();
      }
    }

    function open(config = {}) {
      if (!config.modal) return;
      if (active) close();
      const background = documentRef
        && typeof documentRef.querySelectorAll === 'function'
        ? Array.from(documentRef.querySelectorAll(backgroundSelector)).map(element => ({
          element,
          inert: Boolean(element.inert),
          ariaHidden: element.getAttribute('aria-hidden')
        }))
        : [];
      background.forEach(record => {
        record.element.inert = true;
        record.element.setAttribute('aria-hidden', 'true');
      });
      active = {
        modal: config.modal,
        close: config.close,
        previousFocus: documentRef && documentRef.activeElement,
        background
      };
      config.modal.style.display = 'flex';
      const firstControl = getFocusables(config.modal)[0];
      if (firstControl && typeof firstControl.focus === 'function') {
        firstControl.focus();
      } else if (typeof config.modal.focus === 'function') {
        config.modal.focus();
      }
    }

    function handleKeydown(event) {
      if (!active) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (typeof active.close === 'function') {
          active.close();
        } else {
          close();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = getFocusables(active.modal);
      if (focusables.length === 0) {
        event.preventDefault();
        if (typeof active.modal.focus === 'function') active.modal.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    if (documentRef && typeof documentRef.addEventListener === 'function') {
      documentRef.addEventListener('keydown', handleKeydown);
    }

    return { open, close, handleKeydown };
  }

  function createBackupUI(options = {}) {
    const documentRef = options.document || (root && root.document);
    const service = options.service || (root && root.ExpenseBackupService);
    const now = options.now || (() => new Date());
    const dateFormatter = options.dateFormatter;
    const toast = options.toast || (message => {
      if (root && typeof root.showToast === 'function') root.showToast(message);
    });
    const loadTags = options.loadTags || (() => (
      root && typeof root.loadTags === 'function' ? root.loadTags() : undefined
    ));
    const renderExpenseList = options.renderExpenseList || (() => (
      root && typeof root.renderExpenseList === 'function'
        ? root.renderExpenseList()
        : undefined
    ));
    const refreshDashboard = options.refreshDashboard || (() => (
      root && typeof root.refreshDashboard === 'function'
        ? root.refreshDashboard()
        : undefined
    ));
    const getAdditionalReminders = options.getAdditionalReminders || (() => (
      root && Array.isArray(root.ExpenseDashboardReminders)
        ? root.ExpenseDashboardReminders
        : []
    ));

    let selectedRestoreFile = null;
    let inspectedBackup = null;
    let restoring = false;
    let encrypting = false;
    const modalManager = options.modalManager || createModalManager({
      document: documentRef
    });

    function element(id) {
      return documentRef && typeof documentRef.getElementById === 'function'
        ? documentRef.getElementById(id)
        : null;
    }

    function setRestoreButtonsDisabled(disabled) {
      ['backup-restore-merge', 'backup-restore-replace'].forEach(id => {
        const button = element(id);
        if (button) button.disabled = disabled;
      });
    }

    function showError(error) {
      toast(error && error.message ? error.message : String(error || '操作失败'));
    }

    function renderReminder(decision) {
      const container = element('dashboard-attention');
      if (!container) return;
      const reminders = [...getAdditionalReminders()];
      if (decision && decision.remind) {
        reminders.push({
          id: 'backup',
          priority: 30,
          title: '建议备份账单',
          description: '一键保存完整数据，防止浏览器清理后丢失。'
        });
      }
      const reminder = chooseDashboardReminder(reminders);
      container.hidden = !reminder;
      container.innerHTML = reminder ? renderReminderHtml(reminder) : '';
    }

    async function refresh() {
      if (!service || typeof service.getBackupStatus !== 'function') return;
      const { meta = {}, decision = {} } = await service.getBackupStatus();
      const title = element('backup-status-title');
      const description = element('backup-status-desc');
      const persistent = element('persistent-storage-status');
      if (title) title.textContent = '数据安全';
      if (description) {
        description.textContent = formatRelativeStatus(
          meta.lastBackupAt,
          meta.lastBackupExpenseCount,
          now()
        );
      }
      if (persistent) {
        persistent.textContent = {
          granted: '浏览器存储保护已开启',
          denied: '浏览器未授予存储保护',
          unsupported: '当前浏览器不支持存储保护'
        }[meta.persistentStorage] || '尚未检查存储保护';
      }
      renderReminder(decision);
    }

    async function downloadBackup() {
      try {
        await service.downloadPlainBackup();
        toast('完整备份已下载');
        await refresh();
      } catch (error) {
        showError(error);
      }
    }

    function toggleMore(button) {
      const panel = element('backup-more-options');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (button && typeof button.setAttribute === 'function') {
        button.setAttribute('aria-expanded', String(!panel.hidden));
      }
    }

    function chooseRestoreFile() {
      const input = element('backup-restore-input');
      if (input) input.click();
    }

    function showRestoreSummary(result) {
      inspectedBackup = result.backup;
      const summary = element('backup-restore-summary');
      const actions = element('backup-restore-actions');
      const passwordArea = element('backup-password-area');
      if (summary) summary.innerHTML = renderRestoreSummaryHtml(result, dateFormatter);
      if (passwordArea) passwordArea.hidden = true;
      if (actions) actions.hidden = false;
      setRestoreButtonsDisabled(false);
    }

    async function handleRestoreFile(file) {
      if (!file) return;
      selectedRestoreFile = file;
      inspectedBackup = null;
      const modal = element('backup-restore-modal');
      modalManager.open({ modal, close: closeRestore });
      const summary = element('backup-restore-summary');
      const passwordArea = element('backup-password-area');
      const actions = element('backup-restore-actions');
      if (summary) summary.textContent = '正在检查备份…';
      if (passwordArea) passwordArea.hidden = true;
      if (actions) actions.hidden = true;
      setRestoreButtonsDisabled(false);
      try {
        const result = await service.inspectBackupFile(file);
        if (result.requiresPassword) {
          if (passwordArea) passwordArea.hidden = false;
          if (summary) summary.textContent = '这是加密备份，请输入创建备份时使用的密码。';
          const password = element('backup-restore-password');
          if (password) password.focus();
          return;
        }
        showRestoreSummary(result);
      } catch (error) {
        if (summary) summary.textContent = '无法检查此备份。';
        if (actions) actions.hidden = true;
        showError(error);
      }
    }

    async function unlockRestore() {
      if (!selectedRestoreFile) return;
      const password = element('backup-restore-password');
      try {
        const result = await service.inspectBackupFile(
          selectedRestoreFile,
          password ? password.value : ''
        );
        showRestoreSummary(result);
      } catch (error) {
        const actions = element('backup-restore-actions');
        if (actions) actions.hidden = true;
        showError(error);
      }
    }

    async function restore(mode) {
      if (!inspectedBackup || restoring) return;
      restoring = true;
      setRestoreButtonsDisabled(true);
      try {
        const result = await service.restoreBackup(inspectedBackup, mode);
        closeRestore();
        await Promise.allSettled([
          Promise.resolve().then(loadTags),
          Promise.resolve().then(renderExpenseList),
          Promise.resolve().then(refreshDashboard),
          Promise.resolve().then(refresh)
        ]);
        const successMessage = mode === 'replace' ? '备份已覆盖恢复' : '备份已合并';
        toast(result && result.metadataWarning
          ? `${successMessage}；数据已恢复，但备份状态未能更新`
          : successMessage);
      } catch (error) {
        showError(error);
      } finally {
        restoring = false;
        setRestoreButtonsDisabled(false);
      }
    }

    function closeRestore() {
      modalManager.close();
      const password = element('backup-restore-password');
      const summary = element('backup-restore-summary');
      const actions = element('backup-restore-actions');
      const passwordArea = element('backup-password-area');
      if (password) password.value = '';
      if (summary) summary.textContent = '';
      if (actions) actions.hidden = true;
      if (passwordArea) passwordArea.hidden = true;
      selectedRestoreFile = null;
      inspectedBackup = null;
    }

    async function snooze() {
      try {
        await service.snoozeBackupReminder();
        await refresh();
      } catch (error) {
        showError(error);
      }
    }

    async function chooseAutomaticFile() {
      try {
        const result = await service.chooseAutomaticBackupFile();
        if (!result.supported) {
          toast('当前浏览器不支持自动保存文件，可继续使用普通备份');
          await refresh();
          return;
        }
        if (result.status === 'selection-cancelled') return;
        if (!result.ok) {
          throw result.error || new Error('自动保存文件设置失败');
        }
        toast('自动备份文件已设置');
        await refresh();
      } catch (error) {
        showError(error);
      }
    }

    function openEncryptedBackup() {
      const password = element('backup-encrypted-password');
      const confirmation = element('backup-encrypted-confirm');
      const error = element('backup-encrypted-error');
      if (password) password.value = '';
      if (confirmation) confirmation.value = '';
      if (error) error.textContent = '';
      modalManager.open({
        modal: element('backup-encrypted-modal'),
        close: closeEncryptedBackup
      });
    }

    function closeEncryptedBackup() {
      modalManager.close();
      const password = element('backup-encrypted-password');
      const confirmation = element('backup-encrypted-confirm');
      const error = element('backup-encrypted-error');
      if (password) password.value = '';
      if (confirmation) confirmation.value = '';
      if (error) error.textContent = '';
    }

    async function createEncryptedBackup() {
      if (encrypting) return;
      const password = element('backup-encrypted-password');
      const confirmation = element('backup-encrypted-confirm');
      const error = element('backup-encrypted-error');
      const submit = element('backup-encrypted-submit');
      const passwordValue = password ? password.value : '';
      const confirmationValue = confirmation ? confirmation.value : '';
      if (!passwordValue) {
        if (error) error.textContent = '请输入备份密码';
        if (password) password.focus();
        return;
      }
      if (passwordValue !== confirmationValue) {
        if (error) error.textContent = '两次输入的密码不一致';
        if (confirmation) confirmation.focus();
        return;
      }
      encrypting = true;
      if (submit) submit.disabled = true;
      if (error) error.textContent = '';
      try {
        await service.downloadEncryptedBackup(passwordValue);
        closeEncryptedBackup();
        toast('加密备份已下载，请妥善保管密码');
        await refresh();
      } catch (operationError) {
        showError(operationError);
      } finally {
        encrypting = false;
        if (submit) submit.disabled = false;
      }
    }

    const restoreInput = element('backup-restore-input');
    if (restoreInput && typeof restoreInput.addEventListener === 'function') {
      restoreInput.addEventListener('change', event => {
        const input = event.target;
        const file = input.files && input.files[0];
        input.value = '';
        if (file) handleRestoreFile(file);
      });
    }

    return {
      refresh,
      downloadBackup,
      toggleMore,
      chooseRestoreFile,
      handleRestoreFile,
      unlockRestore,
      restore,
      closeRestore,
      snooze,
      chooseAutomaticFile,
      openEncryptedBackup,
      closeEncryptedBackup,
      createEncryptedBackup
    };
  }

  return {
    escapeHtml,
    formatRelativeStatus,
    formatBackupDate,
    chooseDashboardReminder,
    renderReminderHtml,
    renderRestoreSummaryHtml,
    createModalManager,
    createBackupUI
  };
});
