// ──────────────────────────────────────────────
// MCPService — Toolbox routing + fallback tests
// ──────────────────────────────────────────────

import { MCPService } from './mcp.service';
import { ConnectorType, ConnectionParams } from '../common/types';
import { ToolboxClientService } from './toolbox/toolbox-client.service';

function makeConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    MCP_EXECUTION_TIMEOUT_MS: 30000,
    MCP_MAX_RESULT_ROWS: 500,
    TOOLBOX_ENABLED: 'true',
    TOOLBOX_ROUTED_CONNECTORS: 'postgres,mysql',
    ...overrides,
  };
  return { get: (k: string) => values[k] } as any;
}

function makeToolbox(): jest.Mocked<Pick<ToolboxClientService, 'isHealthy' | 'invokeExecuteSql'>> {
  return {
    isHealthy: jest.fn(),
    invokeExecuteSql: jest.fn(),
  } as any;
}

const PARAMS: ConnectionParams = {
  host: 'h', port: 5432, username: 'u', password: 'p',
  database: 'd', connectorType: ConnectorType.POSTGRES,
};

function seedSession(svc: MCPService) {
  (svc as any).sessions.set('s1', {
    sessionId: 's1', connectorId: 'c1', connectorType: ConnectorType.POSTGRES,
    params: PARAMS, capabilities: {}, isActive: true, createdAt: new Date(),
  });
  jest.spyOn(svc as any, 'resolveConnectionParams').mockReturnValue(PARAMS);
}

describe('MCPService Toolbox routing', () => {
  afterEach(() => jest.restoreAllMocks());

  it('routes through Toolbox when enabled + healthy', async () => {
    const toolbox = makeToolbox();
    toolbox.isHealthy.mockResolvedValue(true);
    toolbox.invokeExecuteSql.mockResolvedValue({
      rows: [{ x: 1 }], columns: ['x'], rowCount: 1, executionTimeMs: 5,
    });
    const svc = new MCPService(makeConfig(), toolbox as any);
    seedSession(svc);

    const res = await svc.executeReadQuery('s1', 'SELECT 1');

    expect(toolbox.invokeExecuteSql).toHaveBeenCalledWith(expect.stringMatching(/^conn_/), 'SELECT 1');
    expect(res.success).toBe(true);
    expect(res.data?.rows).toEqual([{ x: 1 }]);
  });

  it('falls back to the native connector when Toolbox throws', async () => {
    const toolbox = makeToolbox();
    toolbox.isHealthy.mockResolvedValue(true);
    toolbox.invokeExecuteSql.mockRejectedValue(new Error('sidecar down'));
    const svc = new MCPService(makeConfig(), toolbox as any);
    seedSession(svc);

    const native = (svc as any).connectorRegistry.get(ConnectorType.POSTGRES);
    const nativeResult = { success: true, data: { rows: [{ n: 9 }], columns: ['n'], rowCount: 1, executionTimeMs: 3 }, executionTimeMs: 3 };
    jest.spyOn(native, 'executeReadQuery').mockResolvedValue(nativeResult);

    const res = await svc.executeReadQuery('s1', 'SELECT 1');

    expect(toolbox.invokeExecuteSql).toHaveBeenCalled();
    expect(native.executeReadQuery).toHaveBeenCalled();
    expect(res).toBe(nativeResult);
  });

  it('never touches Toolbox when disabled', async () => {
    const toolbox = makeToolbox();
    const svc = new MCPService(makeConfig({ TOOLBOX_ENABLED: 'false' }), toolbox as any);
    seedSession(svc);

    const native = (svc as any).connectorRegistry.get(ConnectorType.POSTGRES);
    jest.spyOn(native, 'executeReadQuery').mockResolvedValue({ success: true, executionTimeMs: 1 });

    await svc.executeReadQuery('s1', 'SELECT 1');

    expect(toolbox.isHealthy).not.toHaveBeenCalled();
    expect(toolbox.invokeExecuteSql).not.toHaveBeenCalled();
    expect(native.executeReadQuery).toHaveBeenCalled();
  });

  it('skips Toolbox for a connector outside the routed allowlist', async () => {
    const toolbox = makeToolbox();
    toolbox.isHealthy.mockResolvedValue(true);
    const svc = new MCPService(makeConfig({ TOOLBOX_ROUTED_CONNECTORS: 'mysql' }), toolbox as any);
    seedSession(svc); // session is postgres

    const native = (svc as any).connectorRegistry.get(ConnectorType.POSTGRES);
    jest.spyOn(native, 'executeReadQuery').mockResolvedValue({ success: true, executionTimeMs: 1 });

    await svc.executeReadQuery('s1', 'SELECT 1');

    expect(toolbox.invokeExecuteSql).not.toHaveBeenCalled();
    expect(native.executeReadQuery).toHaveBeenCalled();
  });
});
