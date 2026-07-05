// ──────────────────────────────────────────────
// MCP Module — Connector Registration + Toolbox sidecar wiring
// ──────────────────────────────────────────────

import { Global, Module } from '@nestjs/common';
import { MCPService } from './mcp.service';
import { ToolboxClientService } from './toolbox/toolbox-client.service';
import { ToolboxConfigService } from './toolbox/toolbox-config.service';

@Global()
@Module({
  providers: [MCPService, ToolboxClientService, ToolboxConfigService],
  exports: [MCPService, ToolboxClientService, ToolboxConfigService],
})
export class MCPModule {}
