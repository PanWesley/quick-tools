(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const nodeCrypto = require('crypto').webcrypto;
    const nodeText = require('util');
    module.exports = factory(
      nodeCrypto,
      root && root.TextEncoder || nodeText.TextEncoder,
      root && root.TextDecoder || nodeText.TextDecoder,
      root
    );
  } else if (root) {
    root.ExpenseBackupCrypto = factory(
      root.crypto,
      root.TextEncoder,
      root.TextDecoder,
      root
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(
  cryptoApi,
  TextEncoderApi,
  TextDecoderApi,
  root
) {
  const FORMAT = 'expense-tracker-encrypted-backup';
  const VERSION = 1;
  const KDF_NAME = 'PBKDF2';
  const HASH = 'SHA-256';
  const ITERATIONS = 250000;
  const CIPHER_NAME = 'AES-GCM';
  const SALT_BYTES = 16;
  const IV_BYTES = 12;

  function requirePassword(password) {
    if (typeof password !== 'string' || password.trim() === '') {
      throw new Error('Password is required');
    }
  }

  function bytesToBase64(bytes) {
    if (root && typeof root.btoa === 'function') {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return root.btoa(binary);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    throw new Error('Base64 encoding is not available');
  }

  function base64ToBytes(value) {
    if (typeof value !== 'string'
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      throw new Error('Encrypted backup contains invalid base64');
    }

    if (root && typeof root.atob === 'function') {
      const binary = root.atob(value);
      return Uint8Array.from(binary, character => character.charCodeAt(0));
    }
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(value, 'base64'));
    }
    throw new Error('Base64 decoding is not available');
  }

  function decodeEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || envelope.format !== FORMAT
      || envelope.version !== VERSION
      || !envelope.kdf
      || typeof envelope.kdf !== 'object'
      || Array.isArray(envelope.kdf)
      || envelope.kdf.name !== KDF_NAME
      || envelope.kdf.hash !== HASH
      || envelope.kdf.iterations !== ITERATIONS
      || !envelope.cipher
      || typeof envelope.cipher !== 'object'
      || Array.isArray(envelope.cipher)
      || envelope.cipher.name !== CIPHER_NAME) {
      throw new Error('Unsupported encrypted backup format');
    }

    const salt = base64ToBytes(envelope.kdf.salt);
    const iv = base64ToBytes(envelope.cipher.iv);
    const data = base64ToBytes(envelope.cipher.data);
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || data.length < 16) {
      throw new Error('Encrypted backup has invalid parameters');
    }
    return { salt, iv, data };
  }

  function isEncryptedBackup(value) {
    try {
      decodeEnvelope(value);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function deriveKey(password, salt) {
    const encoder = new TextEncoderApi();
    const passwordKey = await cryptoApi.subtle.importKey(
      'raw',
      encoder.encode(password),
      KDF_NAME,
      false,
      ['deriveKey']
    );
    return cryptoApi.subtle.deriveKey(
      {
        name: KDF_NAME,
        hash: HASH,
        iterations: ITERATIONS,
        salt
      },
      passwordKey,
      { name: CIPHER_NAME, length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptBackup(plainText, password) {
    requirePassword(password);
    const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(password, salt);
    const data = await cryptoApi.subtle.encrypt(
      { name: CIPHER_NAME, iv },
      key,
      new TextEncoderApi().encode(String(plainText))
    );

    return {
      format: FORMAT,
      version: VERSION,
      kdf: {
        name: KDF_NAME,
        hash: HASH,
        iterations: ITERATIONS,
        salt: bytesToBase64(salt)
      },
      cipher: {
        name: CIPHER_NAME,
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(data))
      }
    };
  }

  async function decryptBackup(envelope, password) {
    requirePassword(password);
    const { salt, iv, data } = decodeEnvelope(envelope);
    const key = await deriveKey(password, salt);
    const plainText = await cryptoApi.subtle.decrypt(
      { name: CIPHER_NAME, iv },
      key,
      data
    );
    return new TextDecoderApi().decode(plainText);
  }

  return {
    encryptBackup,
    decryptBackup,
    isEncryptedBackup
  };
});
