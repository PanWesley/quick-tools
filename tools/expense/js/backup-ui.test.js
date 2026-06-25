const assert = require('assert');

const {
  escapeHtml,
  formatRelativeStatus,
  chooseDashboardReminder,
  renderReminderHtml,
  renderRestoreSummaryHtml,
  createModalManager,
  createBackupUI
} = require('./backup-ui');

function createElement() {
  const value = {
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    value: '',
    files: [],
    style: { display: 'none' },
    attributes: {},
    listeners: {},
    clickCount: 0,
    focusCount: 0,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    click() {
      this.clickCount += 1;
    },
    focus() {
      this.focusCount += 1;
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
    }
  };
  return value;
}

function createModalManagerHarness() {
  const listeners = {};
  const background = [createElement(), createElement(), createElement()];
  background[1].setAttribute('aria-hidden', 'false');
  const previous = createElement();
  const first = createElement();
  const middle = createElement();
  const last = createElement();
  const modal = createElement();
  modal.style.display = 'none';
  modal.querySelectorAll = () => [first, middle, last];
  const document = {
    activeElement: previous,
    addEventListener(name, handler) {
      listeners[name] = handler;
    },
    querySelectorAll(selector) {
      assert.strictEqual(selector, 'main, header, nav');
      return background;
    }
  };
  [previous, first, middle, last, modal, ...background].forEach(item => {
    item.ownerDocument = document;
  });
  return { document, listeners, background, previous, first, middle, last, modal };
}

function createHarness(overrides = {}) {
  const ids = [
    'backup-status-title',
    'backup-status-desc',
    'persistent-storage-status',
    'dashboard-attention',
    'backup-more-options',
    'backup-restore-input',
    'backup-restore-modal',
    'backup-restore-dialog',
    'backup-restore-close',
    'backup-password-area',
    'backup-restore-password',
    'backup-restore-summary',
    'backup-restore-actions',
    'backup-restore-merge',
    'backup-restore-replace',
    'backup-encrypted-modal',
    'backup-encrypted-close',
    'backup-encrypted-password',
    'backup-encrypted-confirm',
    'backup-encrypted-error',
    'backup-encrypted-submit'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, createElement()]));
  elements['backup-more-options'].hidden = true;
  elements['dashboard-attention'].hidden = true;
  elements['backup-password-area'].hidden = true;
  elements['backup-restore-actions'].hidden = true;
  const background = [createElement(), createElement(), createElement()];

  const document = {
    activeElement: createElement(),
    addEventListener() {},
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      assert.strictEqual(selector, 'main, header, nav');
      return background;
    }
  };
  Object.values(elements).forEach(item => {
    item.ownerDocument = document;
  });
  background.forEach(item => {
    item.ownerDocument = document;
  });
  document.activeElement.ownerDocument = document;
  elements['backup-restore-modal'].querySelectorAll = () => [
    elements['backup-restore-close'],
    elements['backup-restore-password'],
    elements['backup-restore-merge'],
    elements['backup-restore-replace']
  ];
  elements['backup-encrypted-modal'].querySelectorAll = () => [
    elements['backup-encrypted-close'],
    elements['backup-encrypted-password'],
    elements['backup-encrypted-confirm'],
    elements['backup-encrypted-submit']
  ];
  const toasts = [];
  const calls = [];
  const service = {
    async getBackupStatus() {
      return {
        meta: {
          lastBackupAt: '2026-06-24T08:00:00.000Z',
          lastBackupExpenseCount: 7,
          persistentStorage: 'granted'
        },
        decision: { remind: true, reason: 'age' }
      };
    },
    async downloadPlainBackup() {
      calls.push('plain');
    },
    async inspectBackupFile(file, password) {
      calls.push(['inspect', file.name, password]);
      return {
        encrypted: false,
        requiresPassword: false,
        backup: {
          exportedAt: '2026-06-23T12:30:00.000Z',
          appVersion: '<img src=x onerror=alert(1)>'
        },
        summary: {
          expenseCount: 4,
          tagCount: 2,
          newExpenseCount: 3,
          conflictCount: 1
        }
      };
    },
    async restoreBackup() {
      calls.push('restore');
      return { restored: true, metadataWarning: new Error('metadata unavailable') };
    },
    async snoozeBackupReminder() {
      calls.push('snooze');
    },
    async chooseAutomaticBackupFile() {
      return { supported: false };
    },
    async downloadEncryptedBackup(password) {
      calls.push(['encrypted', password]);
    },
    ...overrides.service
  };

  const ui = createBackupUI({
    document,
    service,
    now: () => new Date('2026-06-25T08:00:00.000Z'),
    toast(message) {
      toasts.push(message);
    },
    async loadTags() {
      calls.push('tags');
    },
    async renderExpenseList() {
      calls.push('list');
    },
    async refreshDashboard() {
      calls.push('dashboard');
    }
  });
  return { ui, elements, background, document, toasts, calls, service };
}

async function run() {
  const modalHarness = createModalManagerHarness();
  let closedByEscape = 0;
  const modalManager = createModalManager({
    document: modalHarness.document
  });
  modalManager.open({
    modal: modalHarness.modal,
    close() {
      closedByEscape += 1;
      modalManager.close();
    }
  });
  assert.strictEqual(modalHarness.modal.style.display, 'flex');
  assert.strictEqual(modalHarness.document.activeElement, modalHarness.first);
  modalHarness.background.forEach(item => {
    assert.strictEqual(item.inert, true);
    assert.strictEqual(item.getAttribute('aria-hidden'), 'true');
  });

  modalHarness.document.activeElement = modalHarness.last;
  let tabPrevented = false;
  modalHarness.listeners.keydown({
    key: 'Tab',
    shiftKey: false,
    preventDefault() {
      tabPrevented = true;
    }
  });
  assert.strictEqual(tabPrevented, true);
  assert.strictEqual(modalHarness.document.activeElement, modalHarness.first);

  modalHarness.document.activeElement = modalHarness.first;
  let shiftTabPrevented = false;
  modalHarness.listeners.keydown({
    key: 'Tab',
    shiftKey: true,
    preventDefault() {
      shiftTabPrevented = true;
    }
  });
  assert.strictEqual(shiftTabPrevented, true);
  assert.strictEqual(modalHarness.document.activeElement, modalHarness.last);

  modalHarness.listeners.keydown({
    key: 'Escape',
    preventDefault() {}
  });
  assert.strictEqual(closedByEscape, 1);
  assert.strictEqual(modalHarness.modal.style.display, 'none');
  assert.strictEqual(modalHarness.document.activeElement, modalHarness.previous);
  assert.strictEqual(modalHarness.background[0].inert, false);
  assert.strictEqual(modalHarness.background[0].getAttribute('aria-hidden'), null);
  assert.strictEqual(modalHarness.background[1].getAttribute('aria-hidden'), 'false');

  assert.strictEqual(
    escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.strictEqual(
    formatRelativeStatus(null, 0, new Date('2026-06-25T08:00:00.000Z')),
    '尚未创建完整备份'
  );
  assert.strictEqual(
    formatRelativeStatus(
      '2026-06-25T00:01:00.000Z',
      3,
      new Date('2026-06-25T08:00:00.000Z')
    ),
    '今天已备份 · 3 笔'
  );
  assert.strictEqual(
    formatRelativeStatus(
      '2026-06-22T08:00:00.000Z',
      5,
      new Date('2026-06-25T08:00:00.000Z')
    ),
    '3 天前已备份 · 5 笔'
  );

  assert.deepStrictEqual(
    chooseDashboardReminder([
      { id: 'backup', priority: 20 },
      { id: 'budget', priority: 40 },
      { id: 'recurring', priority: 30 }
    ]),
    { id: 'budget', priority: 40 }
  );
  assert.strictEqual(chooseDashboardReminder([]), null);

  const reminderHtml = renderReminderHtml({
    title: '<script>alert(1)</script>',
    description: '保存 & 安全'
  });
  assert.ok(reminderHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(reminderHtml.includes('保存 &amp; 安全'));
  assert.ok(!reminderHtml.includes('<script>'));

  const summaryHtml = renderRestoreSummaryHtml({
    backup: {
      exportedAt: '2026-06-23T12:30:00.000Z',
      appVersion: '<img src=x onerror=alert(1)>'
    },
    summary: {
      expenseCount: 4,
      tagCount: 2,
      newExpenseCount: 3,
      conflictCount: 1
    }
  });
  assert.ok(summaryHtml.includes('2026-06-23 12:30'));
  assert.ok(summaryHtml.includes('4 笔账单'));
  assert.ok(summaryHtml.includes('2 个标签'));
  assert.ok(summaryHtml.includes('3 笔新增'));
  assert.ok(summaryHtml.includes('1 项冲突'));
  assert.ok(summaryHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!summaryHtml.includes('<img'));

  const harness = createHarness();
  await harness.ui.refresh();
  assert.strictEqual(harness.elements['backup-status-title'].textContent, '数据安全');
  assert.strictEqual(
    harness.elements['backup-status-desc'].textContent,
    '1 天前已备份 · 7 笔'
  );
  assert.strictEqual(
    harness.elements['persistent-storage-status'].textContent,
    '浏览器存储保护已开启'
  );
  assert.strictEqual(harness.elements['dashboard-attention'].hidden, false);
  assert.strictEqual(
    (harness.elements['dashboard-attention'].innerHTML.match(/attention-card/g) || []).length,
    1
  );

  const moreButton = createElement();
  harness.ui.toggleMore(moreButton);
  assert.strictEqual(harness.elements['backup-more-options'].hidden, false);
  assert.strictEqual(moreButton.attributes['aria-expanded'], 'true');

  harness.ui.chooseRestoreFile();
  assert.strictEqual(harness.elements['backup-restore-input'].clickCount, 1);
  await harness.ui.handleRestoreFile({ name: 'plain.json', text: async () => '{}' });
  assert.strictEqual(harness.elements['backup-restore-modal'].style.display, 'flex');
  assert.strictEqual(harness.elements['backup-restore-close'].focusCount, 1);
  harness.background.forEach(item => assert.strictEqual(item.inert, true));
  assert.strictEqual(harness.elements['backup-restore-actions'].hidden, false);
  assert.ok(!harness.elements['backup-restore-summary'].innerHTML.includes('<img'));

  await Promise.all([
    harness.ui.restore('merge'),
    harness.ui.restore('merge')
  ]);
  assert.strictEqual(harness.calls.filter(value => value === 'restore').length, 1);
  assert.ok(harness.calls.includes('tags'));
  assert.ok(harness.calls.includes('list'));
  assert.ok(harness.calls.includes('dashboard'));
  assert.ok(harness.toasts.includes('备份已合并；数据已恢复，但备份状态未能更新'));
  assert.ok(!harness.toasts.some(message => message.includes('metadata unavailable')));
  harness.background.forEach(item => assert.strictEqual(item.inert, false));

  harness.ui.openEncryptedBackup();
  assert.strictEqual(harness.elements['backup-encrypted-modal'].style.display, 'flex');
  assert.strictEqual(harness.elements['backup-encrypted-close'].focusCount, 1);
  harness.elements['backup-encrypted-password'].value = 'secret';
  harness.elements['backup-encrypted-confirm'].value = 'different';
  await harness.ui.createEncryptedBackup();
  assert.strictEqual(
    harness.elements['backup-encrypted-error'].textContent,
    '两次输入的密码不一致'
  );
  harness.elements['backup-encrypted-confirm'].value = 'secret';
  await harness.ui.createEncryptedBackup();
  assert.ok(harness.calls.some(value => Array.isArray(value)
    && value[0] === 'encrypted'
    && value[1] === 'secret'));

  await harness.ui.chooseAutomaticFile();
  assert.ok(harness.toasts.includes('当前浏览器不支持自动保存文件，可继续使用普通备份'));

  console.log('backup-ui tests passed');
}

run();
