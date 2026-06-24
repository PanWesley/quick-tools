const assert = require('assert');
const { webcrypto } = require('crypto');

const cryptoPath = require.resolve('./backup-crypto');
const previousCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const previousGlobalDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'ExpenseBackupCrypto'
);

Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: webcrypto
});
delete globalThis.ExpenseBackupCrypto;

const {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup
} = require(cryptoPath);

assert.strictEqual(
  Object.prototype.hasOwnProperty.call(globalThis, 'ExpenseBackupCrypto'),
  false
);

async function rejects(operation) {
  await assert.rejects(operation);
}

(async () => {
  const plainText = JSON.stringify({
    expenses: [{ id: 'e1', amount: 12.5, note: 'Lunch 午餐' }]
  });
  const password = 'correct horse battery staple';

  const envelope = await encryptBackup(plainText, password);
  assert.strictEqual(envelope.format, 'expense-tracker-encrypted-backup');
  assert.strictEqual(envelope.version, 1);
  assert.deepStrictEqual(
    {
      name: envelope.kdf.name,
      hash: envelope.kdf.hash,
      iterations: envelope.kdf.iterations
    },
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 250000 }
  );
  assert.strictEqual(Buffer.from(envelope.kdf.salt, 'base64').length, 16);
  assert.strictEqual(envelope.cipher.name, 'AES-GCM');
  assert.strictEqual(Buffer.from(envelope.cipher.iv, 'base64').length, 12);
  assert.ok(Buffer.from(envelope.cipher.data, 'base64').length > 0);
  assert.strictEqual(isEncryptedBackup(envelope), true);
  assert.strictEqual(await decryptBackup(envelope, password), plainText);

  await rejects(() => decryptBackup(envelope, 'wrong password'));

  assert.strictEqual(isEncryptedBackup(null), false);
  assert.strictEqual(isEncryptedBackup({}), false);
  assert.strictEqual(
    isEncryptedBackup({
      ...envelope,
      format: 'unsupported-encrypted-backup'
    }),
    false
  );

  await rejects(() => encryptBackup(plainText, ''));
  await rejects(() => encryptBackup(plainText, '   '));
  await rejects(() => decryptBackup(envelope, ''));
  await assert.rejects(
    () => decryptBackup({}, ''),
    /Unsupported encrypted backup format/
  );

  const secondEnvelope = await encryptBackup(plainText, password);
  assert.notStrictEqual(secondEnvelope.kdf.salt, envelope.kdf.salt);
  assert.notStrictEqual(secondEnvelope.cipher.iv, envelope.cipher.iv);
  assert.notStrictEqual(secondEnvelope.cipher.data, envelope.cipher.data);

  const tamperedData = Buffer.from(envelope.cipher.data, 'base64');
  tamperedData[0] ^= 1;
  await rejects(() => decryptBackup({
    ...envelope,
    cipher: {
      ...envelope.cipher,
      data: tamperedData.toString('base64')
    }
  }, password));

  await rejects(() => decryptBackup({
    ...envelope,
    version: 2
  }, password));

  console.log('backup-crypto tests passed');
})().finally(() => {
  if (previousCryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', previousCryptoDescriptor);
  } else {
    delete globalThis.crypto;
  }
  if (previousGlobalDescriptor) {
    Object.defineProperty(
      globalThis,
      'ExpenseBackupCrypto',
      previousGlobalDescriptor
    );
  } else {
    delete globalThis.ExpenseBackupCrypto;
  }
});
