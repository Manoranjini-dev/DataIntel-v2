import * as sql from 'mssql';
import { ConnectionParams, ConnectorType } from '../../common/types';
import { MSSQLConnector } from './mssql.connector';

/**
 * Microsoft Fabric connector (DS2-03).
 *
 * Fabric's SQL analytics endpoint (Warehouse / Lakehouse SQL endpoint) speaks
 * T-SQL over TDS — identical to SQL Server — so this reuses the entire
 * MSSQLConnector implementation (schema discovery, table discovery, read-only
 * query execution, capabilities) and overrides ONLY the connection/auth.
 *
 * Fabric requires Microsoft Entra ID (Azure AD) auth — not SQL logins. The PRD
 * (DS2-03) requires service principal OR OAuth. Following the BigQuery/Databricks
 * pattern, the credential material is carried in the (encrypted-at-rest) password
 * as a small JSON blob, so no query-time call site needs to change:
 *
 *   Service principal: {"mode":"service_principal","tenantId","clientId","clientSecret"}
 *   OAuth access token: {"mode":"access_token","token":"<bearer>"}
 */
export class FabricConnector extends MSSQLConnector {
  readonly connectorType = ConnectorType.FABRIC;

  constructor() {
    super('FabricConnector');
  }

  protected async createPool(params: ConnectionParams): Promise<sql.ConnectionPool> {
    const auth = this.parseAuth(params.password);

    const config: sql.config = {
      server: params.host,
      port: params.port || 1433,
      database: params.database,
      // Fabric always requires TLS with a real certificate (no self-signed).
      options: { encrypt: true, trustServerCertificate: false },
      connectionTimeout: 15000,
      requestTimeout: 30000,
      authentication:
        auth.mode === 'access_token'
          ? { type: 'azure-active-directory-access-token', options: { token: auth.token } }
          : {
              type: 'azure-active-directory-service-principal-secret',
              options: { clientId: auth.clientId, clientSecret: auth.clientSecret, tenantId: auth.tenantId },
            },
    } as sql.config;

    return new sql.ConnectionPool(config).connect();
  }

  async dispose(): Promise<void> {
    this.logger.log('Fabric connector disposed');
  }

  /**
   * Parse and validate the Fabric auth blob carried in the decrypted password.
   * Returns a discriminated union; throws a clear error on malformed input so a
   * misconfigured connection fails fast instead of hanging on driver auth.
   */
  private parseAuth(
    password: string,
  ):
    | { mode: 'access_token'; token: string }
    | { mode: 'service_principal'; tenantId: string; clientId: string; clientSecret: string } {
    let parsed: any;
    try {
      parsed = JSON.parse(password);
    } catch {
      throw new Error(
        'Microsoft Fabric credentials are malformed. Expected a JSON auth object (service principal or OAuth access token).',
      );
    }

    const mode = parsed?.mode;
    if (mode === 'access_token') {
      if (!parsed.token) throw new Error('Fabric OAuth auth requires a non-empty access token.');
      return { mode: 'access_token', token: String(parsed.token) };
    }
    if (mode === 'service_principal') {
      const { tenantId, clientId, clientSecret } = parsed;
      if (!tenantId || !clientId || !clientSecret) {
        throw new Error('Fabric service-principal auth requires tenantId, clientId, and clientSecret.');
      }
      return { mode: 'service_principal', tenantId: String(tenantId), clientId: String(clientId), clientSecret: String(clientSecret) };
    }
    throw new Error(`Unsupported Fabric auth mode "${mode}". Use "service_principal" or "access_token".`);
  }
}
