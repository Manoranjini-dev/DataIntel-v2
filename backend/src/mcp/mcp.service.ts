// ──────────────────────────────────────────────
// MCP Service — Connector Orchestration & Lifecycle
// ──────────────────────────────────────────────

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  ConnectionParams,
  ConnectorCapabilities,
  ConnectorType,
  SchemaMetadata,
} from '../common/types';
import {
  IMCPConnector,
  MCPJsonRpcRequest,
  MCPJsonRpcResponse,
  MCPQueryResult,
  MCPSession,
  MCPToolCallResult,
  MCPToolDefinition,
  MCPToolResult,
} from './types';
import { MySQLConnector } from './connectors/mysql.connector';
import { PostgresConnector } from './connectors/postgres.connector';
import { MongoDBConnector } from './connectors/mongo.connector';
import { ElasticsearchConnector } from './connectors/elasticsearch.connector';

@Injectable()
export class MCPService implements OnModuleDestroy {
  private readonly logger = new Logger(MCPService.name);

  /** Connector registry — maps ConnectorType to implementation */
  private readonly connectorRegistry: Map<ConnectorType, IMCPConnector>;

  /** Active sessions — maps sessionId to session state */
  private readonly sessions: Map<string, MCPSession> = new Map();

  /** Active connection params — maps connectorId to params with encrypted password */
  private readonly activeParams: Map<string, { params: Omit<ConnectionParams, 'password'>; encryptedPassword: string; iv: string }> = new Map();

  /** Runtime encryption key — generated per process lifecycle, never persisted */
  private readonly encryptionKey: Buffer;

  private readonly executionTimeout: number;
  private readonly maxResultRows: number;

  constructor(private readonly configService: ConfigService) {
    this.executionTimeout =
      this.configService.get<number>('MCP_EXECUTION_TIMEOUT_MS') ?? 30000;
    this.maxResultRows =
      this.configService.get<number>('MCP_MAX_RESULT_ROWS') ?? 500;

    // Generate a runtime-only encryption key from random entropy
    const runtimeSalt = randomBytes(16);
    const runtimeSecret = randomBytes(32).toString('hex');
    this.encryptionKey = scryptSync(runtimeSecret, runtimeSalt, 32);

    // Initialize connector registry
    this.connectorRegistry = new Map<ConnectorType, IMCPConnector>([
      [ConnectorType.MYSQL, new MySQLConnector()],
      [ConnectorType.POSTGRES, new PostgresConnector()],
      [ConnectorType.MONGODB, new MongoDBConnector()],
      [ConnectorType.ELASTICSEARCH, new ElasticsearchConnector()],
    ]);

    this.logger.log(
      `MCP Service initialized with connectors: ${Array.from(this.connectorRegistry.keys()).join(', ')}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    for (const connector of this.connectorRegistry.values()) {
      await connector.dispose();
    }
    this.sessions.clear();
    this.activeParams.clear();
    this.logger.log('MCP Service destroyed — all connectors disposed');
  }

  /** Get connector for a given type */
  private getConnector(type: ConnectorType): IMCPConnector {
    const connector = this.connectorRegistry.get(type);
    if (!connector) {
      throw new Error(`No MCP connector registered for type: ${type}`);
    }
    return connector;
  }

  /** Test database connection through MCP connector */
  async testConnection(params: ConnectionParams): Promise<MCPToolResult<boolean>> {
    this.logger.log(`Testing connection: ${params.connectorType}@${params.host}:${params.port}`);
    const connector = this.getConnector(params.connectorType);
    return connector.testConnection(params);
  }

  /** Create a new MCP session — establish connection boundary */
  async createSession(params: ConnectionParams): Promise<MCPSession> {
    const connector = this.getConnector(params.connectorType);

    // Verify connection
    const testResult = await connector.testConnection(params);
    if (!testResult.success) {
      throw new Error(`Connection failed: ${testResult.error}`);
    }

    // Verify read-only capability
    const capabilities = connector.getCapabilities();
    if (!capabilities.readOnly) {
      throw new Error('Connector does not support read-only mode — connection rejected');
    }

    const connectorId = uuidv4();
    const sessionId = uuidv4();

    const session: MCPSession = {
      sessionId,
      connectorId,
      connectorType: params.connectorType,
      params: {
        host: params.host,
        port: params.port,
        username: params.username,
        database: params.database,
        connectorType: params.connectorType,
      },
      capabilities,
      isActive: true,
      createdAt: new Date(),
    };

    // Store session and encrypted params in memory (never persisted)
    this.sessions.set(sessionId, session);
    this.activeParams.set(connectorId, {
      params: {
        host: params.host,
        port: params.port,
        username: params.username,
        database: params.database,
        connectorType: params.connectorType,
      },
      ...this.encryptPassword(params.password),
    });

    this.logger.log(`MCP session created: ${sessionId} for ${params.connectorType}`);
    return session;
  }

  /** Get session by ID */
  getSession(sessionId: string): MCPSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Retrieve schema metadata through MCP connector */
  async describeSchema(sessionId: string): Promise<MCPToolResult<SchemaMetadata>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      return { success: false, error: 'No active session found', executionTimeMs: 0 };
    }

    const connectionParams = this.resolveConnectionParams(session.connectorId);
    if (!connectionParams) {
      return { success: false, error: 'Connection params not found', executionTimeMs: 0 };
    }

    const connector = this.getConnector(session.connectorType);
    return connector.describeSchema(connectionParams);
  }

  /** Execute a validated read-only query through MCP tool boundary */
  async executeReadQuery(
    sessionId: string,
    sql: string,
  ): Promise<MCPToolResult<MCPQueryResult>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      return { success: false, error: 'No active session found', executionTimeMs: 0 };
    }

    const connectionParams = this.resolveConnectionParams(session.connectorId);
    if (!connectionParams) {
      return { success: false, error: 'Connection params not found', executionTimeMs: 0 };
    }

    const sqlString = typeof sql === 'string' ? sql : JSON.stringify(sql);
    this.logger.log(`Executing query via MCP [session=${sessionId}]: ${sqlString.substring(0, 100)}...`);
    const connector = this.getConnector(session.connectorType);
    return connector.executeReadQuery(connectionParams, sqlString, this.executionTimeout);
  }

  /** Get connector capabilities */
  getCapabilities(connectorType: ConnectorType): ConnectorCapabilities {
    const connector = this.getConnector(connectorType);
    return connector.getCapabilities();
  }

  /** Destroy a session */
  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.activeParams.delete(session.connectorId);
      this.sessions.delete(sessionId);
      this.logger.log(`MCP session destroyed: ${sessionId}`);
    }
  }

  /** Check if a session is active */
  isSessionActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && session.isActive;
  }

  /**
   * Get schema metadata directly from connection params (no persistent session needed).
   * Used by PersistentConnectionService to sync schema for stored connections.
   */
  async getSchema(params: ConnectionParams): Promise<SchemaMetadata | null> {
    const session = await this.createSession(params);
    try {
      const result = await this.describeSchema(session.sessionId);
      return result.success ? (result.data as SchemaMetadata) : null;
    } finally {
      await this.destroySession(session.sessionId);
    }
  }

  // ── Credential Encryption ────────────────────

  /** Encrypt a password for in-memory storage */
  private encryptPassword(password: string): { encryptedPassword: string; iv: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { encryptedPassword: encrypted, iv: iv.toString('hex') };
  }

  /** Decrypt a stored password */
  private decryptPassword(encryptedPassword: string, ivHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encryptedPassword, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /** Resolve full ConnectionParams from stored encrypted data */
  private resolveConnectionParams(connectorId: string): ConnectionParams | null {
    const stored = this.activeParams.get(connectorId);
    if (!stored) return null;
    return {
      ...stored.params,
      password: this.decryptPassword(stored.encryptedPassword, stored.iv),
    };
  }

  // ── MCP JSON-RPC Protocol Layer ──────────────

  /** MCP tools/list — returns all registered tools */
  listTools(): MCPToolDefinition[] {
    return [
      {
        name: 'testConnection',
        description: 'Test connectivity to a database using provided connection parameters.',
        inputSchema: {
          type: 'object',
          properties: {
            connectorType: { type: 'string', enum: ['mysql', 'postgres', 'mongodb', 'elasticsearch'] },
            host: { type: 'string' },
            port: { type: 'number' },
            username: { type: 'string' },
            password: { type: 'string' },
            database: { type: 'string' },
          },
          required: ['connectorType', 'host', 'port', 'username', 'password', 'database'],
        },
      },
      {
        name: 'describeSchema',
        description: 'Retrieve full schema metadata (tables, columns, keys) for an active session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'executeReadQuery',
        description: 'Execute a validated, read-only query against the connected data source (SQL or ES DSL).',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            sql: { type: 'string' },
          },
          required: ['sessionId', 'sql'],
        },
      },
    ];
  }

  /**
   * MCP tools/call — JSON-RPC dispatch to the appropriate connector method.
   * This is the single entry point for all tool invocations through the MCP boundary.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolCallResult> {
    this.logger.log(`MCP tools/call: ${toolName}`);

    switch (toolName) {
      case 'testConnection': {
        const params = args as unknown as ConnectionParams;
        const result = await this.testConnection(params);
        return this.wrapToolResult(result);
      }
      case 'describeSchema': {
        const sessionId = args.sessionId as string;
        const result = await this.describeSchema(sessionId);
        return this.wrapToolResult(result);
      }
      case 'executeReadQuery': {
        const sessionId = args.sessionId as string;
        const sql = args.sql as string;
        const result = await this.executeReadQuery(sessionId, sql);
        return this.wrapToolResult(result);
      }
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
    }
  }

  /**
   * Handle a full JSON-RPC 2.0 request envelope.
   * Supports methods: tools/list, tools/call
   */
  async handleJsonRpc(request: MCPJsonRpcRequest): Promise<MCPJsonRpcResponse> {
    this.logger.log(`MCP JSON-RPC method=${request.method} id=${request.id}`);

    switch (request.method) {
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: { tools: this.listTools() },
        };
      case 'tools/call': {
        const name = request.params?.name as string;
        const toolArgs = (request.params?.arguments as Record<string, unknown>) ?? {};
        const result = await this.callTool(name, toolArgs);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result,
        };
      }
      default:
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`,
          },
        };
    }
  }

  /** Wrap an internal MCPToolResult into the MCP tools/call response format */
  private wrapToolResult<T>(result: MCPToolResult<T>): MCPToolCallResult<T> {
    if (result.success) {
      return {
        content: [{ type: 'json', json: result.data as T }],
      };
    }
    return {
      content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
      isError: true,
    };
  }
}
