// ──────────────────────────────────────────────
// Custom Decorators — Request context extractors
// ──────────────────────────────────────────────

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @CurrentUser() — Extracts the authenticated user from the request.
 * Usage: @CurrentUser() user: SafeAccount
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    // If a specific field is requested, return just that field
    return data ? user?.[data] : user;
  },
);
