// ──────────────────────────────────────────────
// CardController — REST API for Analytics Card Library
// /cards
// ──────────────────────────────────────────────

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CardService, CreateCardDto, UpdateCardDto, CardListOptions } from './card.service';
import { CurrentUser } from '../common/decorators';
import { SafeAccount } from '../auth/auth.service';

@ApiTags('Cards')
@Controller('cards')
export class CardController {
  constructor(private readonly cardService: CardService) {}

  @Get()
  @ApiOperation({ summary: 'List analytics cards (my cards or shared with me)' })
  async list(
    @CurrentUser() user: SafeAccount,
    @Query('view') view?: 'my_cards' | 'shared_with_me',
    @Query('folderId') folderId?: string,
    @Query('tags') tags?: string,
    @Query('visibility') visibility?: string,
    @Query('status') status?: string,
    @Query('datasourceContextType') datasourceContextType?: string,
    @Query('datasourceContextId') datasourceContextId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: 'updated_at' | 'created_at' | 'name',
    @Query('sortDir') sortDir?: 'asc' | 'desc',
  ) {
    const opts: CardListOptions = {
      view,
      folderId,
      tags: tags ? tags.split(',') : undefined,
      visibility,
      status,
      datasourceContextType,
      datasourceContextId,
      search,
      limit: limit ? Math.min(parseInt(limit, 10), 200) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      sortBy,
      sortDir,
    };
    return this.cardService.list(user.id, opts);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new analytics card' })
  async create(
    @CurrentUser() user: SafeAccount,
    @Body() dto: CreateCardDto,
  ) {
    const card = await this.cardService.create(user, dto);
    return { card };
  }

  // Registered before ':cardId' so the literal 'share-targets' segment is
  // never swallowed by the :cardId param route.
  @Get('share-targets')
  @ApiOperation({ summary: 'Search workspace users that a card can be shared with (any role)' })
  async searchShareTargets(
    @CurrentUser() user: SafeAccount,
    @Query('q') q: string = '',
  ) {
    if (user.role === 'VIEWER') {
      throw new ForbiddenException('Viewers cannot share cards');
    }
    const users = await this.cardService.searchShareTargets(q, user.id);
    return { users };
  }

  @Get(':cardId')
  @ApiOperation({ summary: 'Get card by ID' })
  async getById(
    @Param('cardId') cardId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.cardService.getById(cardId, user.id);
  }

  @Patch(':cardId')
  @ApiOperation({ summary: 'Update card (creates new version)' })
  async update(
    @Param('cardId') cardId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: UpdateCardDto,
  ) {
    const card = await this.cardService.update(cardId, user, dto);
    return { card };
  }

  @Delete(':cardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a card' })
  async delete(
    @Param('cardId') cardId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.cardService.softDelete(cardId, user);
  }

  @Post(':cardId/publish')
  @ApiOperation({ summary: 'Publish the current draft version' })
  async publish(
    @Param('cardId') cardId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const card = await this.cardService.publish(cardId, user);
    return { card };
  }

  @Post(':cardId/rollback')
  @ApiOperation({ summary: 'Rollback to a previous version' })
  async rollback(
    @Param('cardId') cardId: string,
    @CurrentUser() user: SafeAccount,
    @Body() body: { version: number },
  ) {
    const card = await this.cardService.rollback(cardId, user, body.version);
    return { card };
  }

  @Get(':cardId/versions')
  @ApiOperation({ summary: 'List all versions of a card' })
  async listVersions(
    @Param('cardId') cardId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.cardService.listVersions(cardId, user.id);
  }

  // ── Sharing endpoints ────────────────────────────────────────

  @Get(':cardId/shares')
  @ApiOperation({ summary: 'List users this card is shared with (owner only)' })
  async listShares(
    @Param('cardId') cardId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.cardService.listShares(cardId, user.id);
  }

  @Post(':cardId/shares')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Share this card with a user by email (owner only)' })
  async shareCard(
    @Param('cardId') cardId: string,
    @CurrentUser() user: SafeAccount,
    @Body() body: { email: string; canEdit: boolean },
  ) {
    return this.cardService.shareCard(cardId, user, body.email, body.canEdit);
  }

  @Put(':cardId/shares/:accountId')
  @ApiOperation({ summary: 'Update a share permission level (owner only)' })
  async updateShare(
    @Param('cardId') cardId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: SafeAccount,
    @Body() body: { canEdit: boolean },
  ) {
    return this.cardService.updateShare(cardId, user.id, accountId, body.canEdit);
  }

  @Delete(':cardId/shares/:accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a user\'s access to this card (owner only)' })
  async revokeShare(
    @Param('cardId') cardId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.cardService.revokeShare(cardId, user.id, accountId);
  }
}
