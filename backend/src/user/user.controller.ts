// ──────────────────────────────────────────────
// User Controller — /api/users (ADMIN only)
// Platform-level user management. Every route is guarded by the global
// AuthGuard plus PlatformRoleGuard requiring the ADMIN role.
// ──────────────────────────────────────────────

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserService } from './user.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, RequirePlatformRole } from '../common/decorators';
import { PlatformRoleGuard } from '../common/guards/platform-role.guard';
import { SafeAccount } from '../auth/auth.service';
import {
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UpdateUserStatusDto,
} from './dto/user.dto';

@ApiTags('User Management')
@Controller('users')
@RequirePlatformRole('ADMIN')
@UseGuards(PlatformRoleGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a user and send an invitation email' })
  async create(
    @CurrentUser() actor: SafeAccount,
    @Body() dto: CreateUserDto,
    @Req() req: Request,
  ) {
    const user = await this.userService.createUser(actor, dto, req.ip, req.headers['user-agent']);
    return {
      success: true,
      message: 'User created successfully. Invitation email sent.',
      user,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List users (paginated / searchable / filterable)' })
  async list(@Query() query: ListUsersQueryDto) {
    return this.userService.listUsers(query);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'View user-management audit logs' })
  async auditLogs(@Query('page') page = '1', @Query('limit') limit = '50') {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const logs = await this.audit.getUserManagementLogs({ limit: l, offset: (p - 1) * l });
    return { logs, page: p, limit: l };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single user' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.userService.getUser(id);
    return { user };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Edit a user (name / email / role / status)' })
  async update(
    @CurrentUser() actor: SafeAccount,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    const user = await this.userService.updateUser(
      actor, id, dto, req.ip, req.headers['user-agent'],
    );
    return { success: true, user };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Deactivate or reactivate a user' })
  async setStatus(
    @CurrentUser() actor: SafeAccount,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @Req() req: Request,
  ) {
    const user = await this.userService.setStatus(
      actor, id, dto.status, req.ip, req.headers['user-agent'],
    );
    return { success: true, user };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a user' })
  async remove(
    @CurrentUser() actor: SafeAccount,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.userService.deleteUser(actor, id, req.ip, req.headers['user-agent']);
    return { success: true, message: 'User deleted' };
  }

  @Post(':id/resend-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend an invitation email' })
  async resendInvitation(
    @CurrentUser() actor: SafeAccount,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const user = await this.userService.resendInvitation(
      actor, id, req.ip, req.headers['user-agent'],
    );
    return { success: true, message: 'Invitation email resent.', user };
  }
}
