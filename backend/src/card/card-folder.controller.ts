// ──────────────────────────────────────────────
// Card Folder Controller
// ──────────────────────────────────────────────

import { Controller, Get, Post, Delete, Body, Param, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CurrentUser } from '../common/decorators';
import { SafeAccount } from '../auth/auth.service';

@Controller('card-folders')
export class CardFolderController {
  constructor(
    private readonly db: DatabaseService,
  ) {}

  @Get()
  async listFolders(@CurrentUser() user: SafeAccount) {
    const folders = await this.db.queryMany(
      `SELECT * FROM card_folders WHERE created_by = $1 AND deleted_at IS NULL ORDER BY name ASC`,
      [user.id]
    );
    return { folders };
  }

  @Post()
  async createFolder(
    @CurrentUser() user: SafeAccount,
    @Body('name') name: string,
    @Body('description') description?: string,
    @Body('parentId') parentId?: string,
  ) {
    const result = await this.db.queryOne(
      `INSERT INTO card_folders (name, description, parent_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, description || null, parentId || null, user.id]
    );
    return { folder: result };
  }

  @Delete(':folderId')
  async deleteFolder(
    @Param('folderId') folderId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const folder = await this.db.queryOne<{ created_by: string }>(
      `SELECT created_by FROM card_folders WHERE id = $1 AND deleted_at IS NULL`,
      [folderId],
    );
    if (folder && folder.created_by !== user.id) {
      throw new ForbiddenException('You do not have access to this folder');
    }
    await this.db.query(
      `UPDATE card_folders SET deleted_at = NOW() WHERE id = $1`,
      [folderId]
    );
    return { success: true };
  }
}
