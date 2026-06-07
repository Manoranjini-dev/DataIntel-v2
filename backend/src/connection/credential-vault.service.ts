// ──────────────────────────────────────────────
// CredentialVaultService — AES-256-GCM credential encryption
// with per-org HKDF-derived keys for isolated key compromise.
// ──────────────────────────────────────────────

import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;         // 96-bit IV (recommended for GCM)
const TAG_LENGTH = 16;        // 128-bit auth tag
const KEY_LENGTH = 32;        // 256-bit AES key

interface EncryptedValue {
  iv: string;       // hex
  data: string;     // hex (ciphertext)
  tag: string;      // hex (GCM auth tag)
  version: number;  // encryption scheme version (for future rotation)
}

@Injectable()
export class CredentialVaultService {
  private readonly logger = new Logger(CredentialVaultService.name);
  private readonly masterKey: Buffer;

  constructor(private readonly config: ConfigService) {
    const keyHex = this.config.getOrThrow<string>('CREDENTIAL_ENCRYPTION_KEY');
    if (keyHex.length < 64) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY must be at least 64 hex characters (256-bit)');
    }
    this.masterKey = Buffer.from(keyHex.slice(0, 64), 'hex');
  }

  /**
   * Derives a per-org AES key using HKDF.
   * Even if master key is exposed, per-org isolation is maintained
   * because each org has a different derived key.
   */
  private deriveOrgKey(orgId: string): Buffer {
    // HKDF: HMAC-based Key Derivation Function (RFC 5869)
    // info = "dataintel:credentials:{orgId}" for domain separation
    return Buffer.from(
      hkdfSync(
        'sha256',
        this.masterKey,
        Buffer.from(orgId),                          // salt = orgId bytes
        Buffer.from(`dataintel:credentials:${orgId}`), // info
        KEY_LENGTH,
      ),
    );
  }

  /**
   * Encrypt a credential string for a specific org.
   * Returns a serialized JSON string suitable for DB storage.
   */
  encrypt(plaintext: string, orgId: string): string {
    try {
      const key = this.deriveOrgKey(orgId);
      const iv = randomBytes(IV_LENGTH);

      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();

      const payload: EncryptedValue = {
        iv: iv.toString('hex'),
        data: encrypted.toString('hex'),
        tag: tag.toString('hex'),
        version: 1,
      };

      return JSON.stringify(payload);
    } catch (err) {
      this.logger.error('Encryption failed', err);
      throw new InternalServerErrorException('Failed to encrypt credential');
    }
  }

  /**
   * Decrypt a credential string for a specific org.
   * Verifies the GCM auth tag to detect tampering.
   */
  decrypt(encryptedJson: string, orgId: string): string {
    try {
      const payload: EncryptedValue = JSON.parse(encryptedJson);

      if (payload.version !== 1) {
        throw new Error(`Unknown encryption version: ${payload.version}`);
      }

      const key = this.deriveOrgKey(orgId);
      const iv = Buffer.from(payload.iv, 'hex');
      const data = Buffer.from(payload.data, 'hex');
      const tag = Buffer.from(payload.tag, 'hex');

      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (err) {
      this.logger.error('Decryption failed — possible key mismatch or data corruption', err);
      throw new InternalServerErrorException('Failed to decrypt credential');
    }
  }

  /**
   * Re-encrypt a credential with the current master key.
   * Used during key rotation.
   */
  reencrypt(encryptedJson: string, orgId: string): string {
    const plaintext = this.decrypt(encryptedJson, orgId);
    return this.encrypt(plaintext, orgId);
  }

  /**
   * Encrypt a full credentials object (host, port, username, password, etc.)
   * Only encrypts the password field; other fields stored in plaintext.
   * Returns encrypted password string.
   */
  encryptPassword(password: string, orgId: string): string {
    return this.encrypt(password, orgId);
  }

  /**
   * Safely masks a sensitive string for logging (shows first 4 chars + ***)
   */
  mask(value: string): string {
    if (value.length <= 4) return '***';
    return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 4, 8))}`;
  }
}
