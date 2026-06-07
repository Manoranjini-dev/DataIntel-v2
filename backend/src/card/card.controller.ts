// ──────────────────────────────────────────────
// CardController — REST API for Analytics Card Library
// /api/orgs/:orgId/cards
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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CardService, CreateCardDto, UpdateCardDto, CardListOptions } from './card.service';
import { CurrentUser, OrgId } from '../common/decorators';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { SafeAccount } from '../auth/auth.service';

@ApiTags('Cards')
@UseGuards(OrgMemberGuard)
@UseInterceptors(RlsContextInterceptor)
@Controller('orgs/:orgId/cards')
export class CardController {
  constructor(private readonly cardService: CardService) {}

  @Get()
  @ApiOperation({ summary: 'List analytics cards for org' })
  async list(
    @OrgId() orgId: string,
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
    return this.cardService.list(orgId, user.id, opts);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new analytics card' })
  async create(
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: CreateCardDto,
  ) {
    return this.cardService.create(orgId, user, dto);
  }

  @Get(':cardId')
  @ApiOperation({ summary: 'Get card by ID' })
  async getById(
    @Param('cardId') cardId: string,
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.cardService.getById(cardId, orgId, user.id);
  }

  @Patch(':cardId')
  @ApiOperation({ summary: 'Update card (creates new version)' })
  async update(
    @Param('cardId') cardId: string,
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: UpdateCardDto,
  ) {
    return this.cardService.update(cardId, orgId, user, dto);
  }

  @Delete(':cardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a card' })
  async delete(
    @Param('cardId') cardId: string,
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.cardService.softDelete(cardId, orgId, user);
  }

  @Post(':cardId/publish')
  @ApiOperation({ summary: 'Publish the current draft version' })
  async publish(
    @Param('cardId') cardId: string,
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.cardService.publish(cardId, orgId, user);
  }

  @Post(':cardId/rollback')
  @ApiOperation({ summary: 'Rollback to a previous version' })
  async rollback(
    @Param('cardId') cardId: string,
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() body: { version: number },
  ) {
    return this.cardService.rollback(cardId, orgId, user, body.version);
  }

  @Get(':cardId/versions')
  @ApiOperation({ summary: 'List all versions of a card' })
  async listVersions(
    @Param('cardId') cardId: string,
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.cardService.listVersions(cardId, orgId, user.id);
  }
}
