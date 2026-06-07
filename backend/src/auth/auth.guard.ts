// ──────────────────────────────────────────────
// Auth Guard — Cookie-based session validation
// ──────────────────────────────────────────────

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, SafeAccount } from './auth.service';

export const IS_PUBLIC_KEY = 'isPublic';

/** Decorator to mark a route as public (no auth required) */
import { SetMetadata } from '@nestjs/common';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Extend Express Request to include the authenticated user */
declare global {
  namespace Express {
    interface Request {
      user?: SafeAccount;
    }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const sessionToken = this.extractSessionToken(request);

    if (!sessionToken) {
      throw new UnauthorizedException('Authentication required');
    }

    const account = await this.authService.validateSession(sessionToken);
    if (!account) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Attach the user to the request
    request.user = account;
    return true;
  }

  private extractSessionToken(request: any): string | null {
    // 1. Try HttpOnly cookie first
    const cookieToken = request.cookies?.['session_token'];
    if (cookieToken) {
      return cookieToken;
    }

    // 2. Fallback to Authorization header (for API clients)
    const authHeader = request.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    return null;
  }
}
