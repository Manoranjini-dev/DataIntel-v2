// ──────────────────────────────────────────────
// Auth Controller — Register, Login, Logout, Me
// ──────────────────────────────────────────────

import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { Public } from './auth.guard';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly cookieDomain: string;
  private readonly cookieSecure: boolean;
  private readonly sessionTtlHours: number;

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {
    this.cookieDomain = this.config.get<string>('COOKIE_DOMAIN', 'localhost');
    this.cookieSecure = this.config.get<string>('COOKIE_SECURE', 'false') === 'true';
    this.sessionTtlHours = this.config.get<number>('SESSION_TTL_HOURS', 168);
  }

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const { account, sessionToken } = await this.authService.register(
      dto.email,
      dto.displayName,
      dto.password,
      ipAddress,
      userAgent,
    );

    this.setSessionCookie(res, sessionToken);
    this.logger.log(`Account registered: ${account.email}`);

    return { success: true, account };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const { account, sessionToken } = await this.authService.login(
      dto.email,
      dto.password,
      ipAddress,
      userAgent,
    );

    this.setSessionCookie(res, sessionToken);
    this.logger.log(`Account logged in: ${account.email}`);

    return { success: true, account };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionToken = req.cookies?.['session_token'];
    const user = req.user;
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (sessionToken) {
      await this.authService.logout(sessionToken, user?.id, ipAddress, userAgent);
    }

    res.clearCookie('session_token', {
      domain: this.cookieDomain,
      path: '/',
    });

    return { success: true };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const oldToken = req.cookies?.['session_token'];
    if (!oldToken) {
      return { success: false };
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    try {
      const newToken = await this.authService.rotateSession(oldToken, ipAddress, userAgent);
      this.setSessionCookie(res, newToken);
      return { success: true };
    } catch (e) {
      res.clearCookie('session_token');
      return { success: false };
    }
  }

  @Get('me')
  async me(@Req() req: Request) {
    return { success: true, account: req.user };
  }

  // ── Private helpers ────────────────────────────

  private setSessionCookie(res: Response, sessionToken: string): void {
    res.cookie('session_token', sessionToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'lax',
      domain: this.cookieDomain,
      path: '/',
      maxAge: this.sessionTtlHours * 60 * 60 * 1000, // ms
    });
  }
}
