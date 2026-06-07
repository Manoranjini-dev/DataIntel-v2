// ──────────────────────────────────────────────
// Encryption Utility — AES-256-GCM for credentials
// ──────────────────────────────────────────────

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey(keyHex: string): Buffer {
  // Ensure exactly 32 bytes
  return Buffer.from(keyHex.slice(0, 64), 'hex');
}

export function encrypt(plaintext: string, keyHex: string): string {
  const key = getKey(keyHex);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(ciphertext: string, keyHex: string): string {
  const key = getKey(keyHex);
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc) .toString('utf8') + decipher.final('utf8');
}
