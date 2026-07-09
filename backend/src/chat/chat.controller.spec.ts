// ──────────────────────────────────────────────
// ChatController unit tests — error-handling contract
//
// Regression guard for the "intermittent HTTP 500" bug: the controller's
// catch blocks reference `HttpException`. If that symbol is ever dropped from
// the `@nestjs/common` import again, ts-jest fails to compile this file AND the
// `throws generic Error` case below throws a ReferenceError instead of
// returning a structured envelope — either way the regression is caught here
// long before it can reach production (the SWC build has typeCheck disabled and
// would silently ship it).
// ──────────────────────────────────────────────

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChatController } from './chat.controller';
import type { SafeAccount } from '../auth/auth.service';

function makeUser(): SafeAccount {
  return {
    id: 'user-1', email: 'user@company.com', displayName: 'User', avatarUrl: null,
    role: 'ANALYST', status: 'ACTIVE', isActive: true, emailVerified: true,
    lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('ChatController — ask() error handling', () => {
  let controller: ChatController;
  let chatQueryService: { query: jest.Mock; executeDraft: jest.Mock };
  const chatService: any = {};
  const llmService: any = {};
  const chatId = 'chat-1';
  const user = makeUser();

  beforeEach(() => {
    chatQueryService = { query: jest.fn(), executeDraft: jest.fn() };
    controller = new ChatController(chatService as any, chatQueryService as any, llmService as any);
  });

  it('returns the service result on success (pass-through)', async () => {
    const ok = { success: true, userMessage: {}, assistantMessage: {}, execution: {} };
    chatQueryService.query.mockResolvedValue(ok);
    await expect(controller.ask(user, chatId, { prompt: 'hi' } as any)).resolves.toBe(ok);
  });

  it('re-throws a sub-500 HttpException so its status is preserved (no ReferenceError)', async () => {
    chatQueryService.query.mockRejectedValue(new BadRequestException('Please enter a question.'));
    // Before the fix this threw `ReferenceError: HttpException is not defined`,
    // which the global filter turned into an opaque 500. It must now re-throw
    // the original 400 so the client sees the correct status.
    await expect(controller.ask(user, chatId, { prompt: '' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('re-throws a 404 HttpException unchanged', async () => {
    chatQueryService.query.mockRejectedValue(new NotFoundException('Chat not found'));
    await expect(controller.ask(user, chatId, { prompt: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('converts an unexpected (non-HTTP) error into a structured failure envelope, never a 500', async () => {
    chatQueryService.query.mockRejectedValue(new Error('boom: unexpected'));
    const res: any = await controller.ask(user, chatId, { prompt: 'x' } as any);
    expect(res.success).toBe(false);
    expect(res.execution.status).toBe('failed');
    expect(Array.isArray(res.followUpQuestions)).toBe(true);
    expect(res.assistantMessage).toBeDefined();
  });
});
