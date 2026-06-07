// ──────────────────────────────────────────────
// Connection Controller — Thin API Layer
// ──────────────────────────────────────────────

import { Body, Controller, Get, Param, Post, HttpCode, HttpStatus, NotFoundException } from '@nestjs/common';
import { ConnectionService } from './connection.service';
import { ConnectDto, TestConnectionDto } from './dto/connection.dto';
import { SchemaService } from '../schema/schema.service';
import { Public } from '../auth/auth.guard';

@Public()
@Controller('connection')
export class ConnectionController {
  constructor(
    private readonly connectionService: ConnectionService,
    private readonly schemaService: SchemaService,
  ) {}

  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testConnection(@Body() dto: TestConnectionDto) {
    return this.connectionService.testConnection(dto);
  }

  @Post('connect')
  async connect(@Body() dto: ConnectDto) {
    const { session, schema } = await this.connectionService.connect(dto);
    return {
      sessionId: session.sessionId,
      connectorType: session.connectorType,
      database: session.params.database,
      host: session.params.host,
      port: session.params.port,
      capabilities: session.capabilities,
      tables: schema.tables.map((t) => ({
        name: t.name,
        columnCount: t.columns.length,
        primaryKeys: t.primaryKeys,
        foreignKeyCount: t.foreignKeys.length,
      })),
    };
  }

  @Get('status/:sessionId')
  getStatus(@Param('sessionId') sessionId: string) {
    const status = this.connectionService.getStatus(sessionId);
    if (!status) {
      return { connected: false };
    }
    return { connected: true, ...status };
  }

  @Get('schema/:sessionId')
  getSchema(@Param('sessionId') sessionId: string) {
    const schema = this.schemaService.getStructuredSchema(sessionId);
    if (!schema) {
      throw new NotFoundException('Session not found or schema unavailable');
    }
    return schema;
  }

  @Get('active')
  getActiveConnections() {
    return this.connectionService.getActiveConnections();
  }

  @Post('disconnect/:sessionId')
  @HttpCode(HttpStatus.OK)
  async disconnect(@Param('sessionId') sessionId: string) {
    await this.connectionService.disconnect(sessionId);
    return { success: true };
  }
}
