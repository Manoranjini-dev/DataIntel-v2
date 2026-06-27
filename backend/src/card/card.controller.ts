// ──────────────────────────────────────────────
// CardController — REST API for Analytics Card Library
// /cards
// ──────────────────────────────────────────────

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
  @ApiOperation({ summary: 'List analytics cards' })
  async list(
    @CurrentUser() user: SafeAccount,
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
}
