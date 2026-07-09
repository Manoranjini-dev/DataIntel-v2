// ──────────────────────────────────────────────
// FabricConnector — DS2-03 Microsoft Fabric (Entra ID auth)
// Verifies the connector identity, SQL family, capability reuse from MSSQL, and
// that the Azure AD auth config is built correctly from the credential blob.
// ──────────────────────────────────────────────

// Stub the mssql driver so createPool never opens a real TDS connection; capture
// the config passed to the pool for assertions.
const capturedConfigs: any[] = [];
jest.mock('mssql', () => ({
  ConnectionPool: class {
    config: any;
    constructor(config: any) { this.config = config; capturedConfigs.push(config); }
    connect() {
      return Promise.resolve({
        request: () => ({ query: () => Promise.resolve({ recordset: [{ ok: 1 }] }) }),
        close: () => Promise.resolve(),
      });
    }
  },
}));

import { FabricConnector } from './fabric.connector';
import { ConnectorType, getConnectorFamily } from '../../common/types';

const BASE = { host: 'ws.datawarehouse.fabric.microsoft.com', port: 1433, username: '', database: 'wh', connectorType: ConnectorType.FABRIC } as any;

describe('FabricConnector', () => {
  beforeEach(() => { capturedConfigs.length = 0; });

  it('identifies as FABRIC and maps to the SQL family (shared validation/query path)', () => {
    const c = new FabricConnector();
    expect(c.connectorType).toBe(ConnectorType.FABRIC);
    expect(getConnectorFamily(ConnectorType.FABRIC)).toBe('sql');
  });

  it('reuses MSSQL read-only capabilities', () => {
    const caps = new FabricConnector().getCapabilities();
    expect(caps.readOnly).toBe(true);
    expect(caps.supportedOperations).toContain('SELECT');
  });

  it('builds a service-principal Azure AD config from the credential blob', async () => {
    const c = new FabricConnector();
    const password = JSON.stringify({ mode: 'service_principal', tenantId: 't1', clientId: 'c1', clientSecret: 's1' });
    await c.testConnection({ ...BASE, password });
    const cfg = capturedConfigs[0];
    expect(cfg.authentication.type).toBe('azure-active-directory-service-principal-secret');
    expect(cfg.authentication.options).toEqual({ clientId: 'c1', clientSecret: 's1', tenantId: 't1' });
    expect(cfg.options.encrypt).toBe(true);
    expect(cfg.options.trustServerCertificate).toBe(false); // Fabric requires a real cert
  });

  it('builds an OAuth access-token Azure AD config', async () => {
    const c = new FabricConnector();
    const password = JSON.stringify({ mode: 'access_token', token: 'bearer-xyz' });
    await c.testConnection({ ...BASE, password });
    const cfg = capturedConfigs[0];
    expect(cfg.authentication.type).toBe('azure-active-directory-access-token');
    expect(cfg.authentication.options).toEqual({ token: 'bearer-xyz' });
  });

  it('fails fast on a malformed credential blob', async () => {
    const c = new FabricConnector();
    const res = await c.testConnection({ ...BASE, password: 'not-json' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/malformed/i);
  });

  it('rejects an incomplete service principal (missing clientSecret)', async () => {
    const c = new FabricConnector();
    const password = JSON.stringify({ mode: 'service_principal', tenantId: 't1', clientId: 'c1' });
    const res = await c.testConnection({ ...BASE, password });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/tenantId, clientId, and clientSecret/);
  });

  it('rejects an unsupported auth mode', async () => {
    const c = new FabricConnector();
    const res = await c.testConnection({ ...BASE, password: JSON.stringify({ mode: 'kerberos' }) });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unsupported Fabric auth mode/);
  });
});
