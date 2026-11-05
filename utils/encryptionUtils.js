const crypto = require('crypto');

const config = require('config');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const SEPARATOR = '.';

/**
 * The 32 byte key, written as 64 hex characters in config (ENCRYPTION_KEY).
 * Read on every call so a missing key fails where it is used, not at startup.
 */
const getKey = () => {
  const hexKey = config.get('encryption.key');
  const key = Buffer.from(hexKey || '', 'hex');

  if (key.length !== KEY_BYTES) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }

  return key;
};

/**
 * Encrypts a string for storage. The result is "iv.tag.cipher", all base64,
 * and differs on every call because the IV is random.
 */
const encryptString = ({plainText}) => {
  const iv = crypto.randomBytes(IV_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });

  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final(),
  ]);

  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64'))
    .join(SEPARATOR);
};

/**
 * Reverses encryptString. Throws when the value was changed or the key is
 * wrong, because the auth tag no longer matches.
 */
const decryptString = ({encryptedText}) => {
  const [iv, tag, encrypted] = String(encryptedText)
    .split(SEPARATOR)
    .map((part) => Buffer.from(part, 'base64'));

  // The tag length is pinned, or a shortened stored tag would still be accepted.
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8'
  );
};

module.exports = {encryptString, decryptString};
