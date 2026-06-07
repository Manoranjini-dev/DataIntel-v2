// ──────────────────────────────────────────────
// RlsContextInterceptor — Sets PostgreSQL row-level security context
// per request. Must run before any database access.
// Sets: SET LOCAL app.current_org_id and app.current_account_id
// ──────────────────────────────────────────────

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class RlsContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RlsContextInterceptor.name);

  constructor(private readonly db: DatabaseService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const orgId: string | undefined = req.params?.orgId;
    const accountId: string | undefined = req.user?.id;

    // Set RLS context for this request if we have org + account
    if (orgId && accountId) {
      // We set these as session-level variables which persist for the duration
      // of a transaction. DatabaseService.transaction() picks them up automatically.
      req.rlsContext = { orgId, accountId };
    }

    return next.handle();
  }
}
