// ──────────────────────────────────────────────
// SSO — unit tests (config helpers + provisioning branches)
// ──────────────────────────────────────────────

import { UnauthorizedException } from '@nestjs/common';
import { SsoConfigService } from './sso-config.service';
import { SsoProvisioningService } from './sso-provisioning.service';
import { SsoProviderRow, ExternalProfile } from './types';
import { decrypt } from '../common/utils/encryption';

const ENC_KEY = 'a'.repeat(64); // 32 bytes hex

function makeConfigService() {
  return {
    getOrThrow: (k: string) => (k === 'CREDENTIAL_ENCRYPTION_KEY' ? ENC_KEY : undefined),
    get: () => undefined,
  } as any;
}

function providerRow(overrides: Partial<SsoProviderRow> = {}): SsoProviderRow {
  return {
    provider: 'google', enabled: true, display_name: 'Google', config: {},
    encrypted_secret: null, auto_provision: false, allowed_domains: [],
    default_role: 'VIEWER', updated_by: null,
    created_at: 'now', updated_at: 'now', ...overrides,
  };
}

describe('SsoConfigService helpers', () => {
  let svc: SsoConfigService;
  beforeEach(() => {
    svc = new SsoConfigService({} as any, makeConfigService(), { log: jest.fn() } as any);
  });

  it('allows any domain when the allowlist is empty', () => {
    expect(svc.isEmailDomainAllowed(providerRow({ allowed_domains: [] }), 'a@x.com')).toBe(true);
  });

  it('enforces the domain allowlist (case-insensitive)', () => {
    const row = providerRow({ allowed_domains: ['corp.com'] });
    expect(svc.isEmailDomainAllowed(row, 'user@CORP.com')).toBe(true);
    expect(svc.isEmailDomainAllowed(row, 'user@evil.com')).toBe(false);
    expect(svc.isEmailDomainAllowed(row, null)).toBe(false);
  });

  it('normalizes roles, defaulting unknowns to VIEWER', () => {
    expect(svc.normalizeRole('admin')).toBe('ADMIN');
    expect(svc.normalizeRole('Analyst')).toBe('ANALYST');
    expect(svc.normalizeRole('superuser')).toBe('VIEWER');
    expect(svc.normalizeRole(null)).toBe('VIEWER');
  });

  it('round-trips and decrypts stored secrets', () => {
    const enc = require('../common/utils/encryption').encrypt('super-secret', ENC_KEY);
    const row = providerRow({ encrypted_secret: enc });
    expect(svc.getDecryptedSecret(row)).toBe('super-secret');
    expect(svc.getDecryptedSecret(providerRow({ encrypted_secret: null }))).toBeNull();
  });
});

describe('SsoConfigService.upsert secret handling', () => {
  it('encrypts a new secret and flags the column for update', async () => {
    let captured: any[] = [];
    const db = {
      queryOne: jest
        .fn()
        .mockResolvedValueOnce(providerRow()) // getRow(existing)
        .mockImplementationOnce((_sql: string, params: any[]) => {
          captured = params;
          return Promise.resolve(providerRow());
        }),
    };
    const svc = new SsoConfigService(db as any, makeConfigService(), { log: jest.fn() } as any);
    await svc.upsert('google', { secret: 'client-secret' }, 'admin-1');

    // params: [provider, enabled, displayName, config, touchSecret(bool), encSecret, ...]
    expect(captured[4]).toBe(true); // secret column touched
    expect(decrypt(captured[5], ENC_KEY)).toBe('client-secret');
  });

  it('keeps the existing secret when none is provided', async () => {
    let captured: any[] = [];
    const db = {
      queryOne: jest
        .fn()
        .mockResolvedValueOnce(providerRow({ encrypted_secret: 'x' }))
        .mockImplementationOnce((_sql: string, params: any[]) => {
          captured = params;
          return Promise.resolve(providerRow());
        }),
    };
    const svc = new SsoConfigService(db as any, makeConfigService(), { log: jest.fn() } as any);
    await svc.upsert('google', { enabled: true }, 'admin-1');
    expect(captured[4]).toBe(false); // secret column NOT touched
  });
});

describe('SsoProvisioningService.resolveOrProvision', () => {
  const profile: ExternalProfile = { subject: 'sub-1', email: 'jane@corp.com', displayName: 'Jane' };
  const activeAccount = { id: 'acc-1', status: 'ACTIVE', is_active: true, is_deleted: false };

  function make(dbOverrides: any, ssoOverrides: any = {}) {
    const db = { queryOne: jest.fn(), query: jest.fn().mockResolvedValue(undefined), ...dbOverrides };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const ssoConfig = {
      getRow: jest.fn(),
      isEmailDomainAllowed: jest.fn().mockReturnValue(true),
      normalizeRole: jest.fn().mockReturnValue('VIEWER'),
      ...ssoOverrides,
    };
    return { svc: new SsoProvisioningService(db as any, audit as any, ssoConfig as any), db, audit, ssoConfig };
  }

  it('returns the account linked by identity', async () => {
    const { svc, db } = make({ queryOne: jest.fn().mockResolvedValueOnce(activeAccount) });
    await expect(svc.resolveOrProvision('google', profile)).resolves.toBe('acc-1');
    expect(db.queryOne).toHaveBeenCalledTimes(1);
  });

  it('links an existing account by email', async () => {
    const { svc, db, audit } = make({
      queryOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(activeAccount),
    });
    await expect(svc.resolveOrProvision('google', profile)).resolves.toBe('acc-1');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('sso_provider'), expect.arrayContaining(['google', 'sub-1', 'acc-1']));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'sso_identity_linked' }));
  });

  it('JIT-provisions when allowed', async () => {
    const created = { id: 'new-1' };
    const { svc } = make(
      { queryOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(created) },
      { getRow: jest.fn().mockResolvedValue(providerRow({ auto_provision: true })) },
    );
    await expect(svc.resolveOrProvision('google', profile)).resolves.toBe('new-1');
  });

  it('rejects when auto-provisioning is disabled', async () => {
    const { svc } = make(
      { queryOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null) },
      { getRow: jest.fn().mockResolvedValue(providerRow({ auto_provision: false })) },
    );
    await expect(svc.resolveOrProvision('google', profile)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the email domain is not allowed', async () => {
    const { svc } = make(
      { queryOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null) },
      {
        getRow: jest.fn().mockResolvedValue(providerRow({ auto_provision: true, allowed_domains: ['corp.com'] })),
        isEmailDomainAllowed: jest.fn().mockReturnValue(false),
      },
    );
    await expect(svc.resolveOrProvision('google', profile)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an inactive linked account', async () => {
    const { svc } = make({
      queryOne: jest.fn().mockResolvedValueOnce({ ...activeAccount, status: 'INACTIVE', is_active: false }),
    });
    await expect(svc.resolveOrProvision('google', profile)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
