// ──────────────────────────────────────────────
// Card Folder Controller
// ──────────────────────────────────────────────

import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OrgPermissionsService } from '../org/org-permissions.service';
import { CurrentUser, OrgId } from '../common/decorators';
import { SafeAccount } from '../auth/auth.service';
import { OrgMemberGuard } from '../common/guards/org-member.guard';

@UseGuards(OrgMemberGuard)
@Controller('orgs/:orgId/card-folders')
export class CardFolderController {
  constructor(
    private readonly db: DatabaseService,
    private readonly orgPermissions: OrgPermissionsService,
  ) {}

  @Get()
  async listFolders(@OrgId() orgId: string, @CurrentUser() user: SafeAccount) {
    await this.orgPermissions.requireMember(orgId, user.id);
    const folders = await this.db.queryMany(
      `SELECT * FROM card_folders WHERE org_id = $1 AND deleted_at IS NULL ORDER BY name ASC`,
      [orgId]
    );
    return { folders };
  }

  @Post()
  async createFolder(
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body('name') name: string,
    @Body('description') description?: string,
    @Body('parentId') parentId?: string,
  ) {
    await this.orgPermissions.requireRole(orgId, user.id, 'editor');
    const result = await this.db.queryOne(
      `INSERT INTO card_folders (org_id, name, description, parent_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [orgId, name, description || null, parentId || null, user.id]
    );
    return { folder: result };
  }

  @Delete(':folderId')
  async deleteFolder(
    @OrgId() orgId: string,
    @Param('folderId') folderId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.orgPermissions.requireRole(orgId, user.id, 'editor');
    await this.db.query(
      `UPDATE card_folders SET deleted_at = NOW() WHERE id = $1 AND org_id = $2`,
      [folderId, orgId]
    );
    return { success: true };
  }
}
