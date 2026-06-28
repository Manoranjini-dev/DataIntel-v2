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
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import {
  LoginDto,
  ActivateAccountDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { Public } from './auth.guard';
import { EmailService } from '../email/email.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly cookieDomain: string;
  private readonly cookieSecure: boolean;
  private readonly sessionTtlHours: number;

  private readonly frontendUrl: string;

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {
    this.cookieDomain = this.config.get<string>('COOKIE_DOMAIN', 'localhost');
    this.cookieSecure = this.config.get<string>('COOKIE_SECURE', 'false') === 'true';
    this.sessionTtlHours = this.config.get<number>('SESSION_TTL_HOURS', 168);
    this.frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  // Self-registration is disabled — accounts are created by an ADMIN via
  // invitation only (see POST /users). Kept as an explicit 403 so clients
  // get a clear message instead of a generic 404.
  @Public()
  @Post('register')
  register() {
    throw new ForbiddenException(
      'Self-registration is disabled. Accounts are created by an administrator by invitation.',
    );
  }

  @Public()
  @Post('activate-account')
  @HttpCode(HttpStatus.OK)
  async activateAccount(@Body() dto: ActivateAccountDto, @Req() req: Request) {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Validates the invitation token (invalid / expired / already-used all throw),
    // sets the bcrypt password, and marks the account ACTIVE. No session is
    // created — the user signs in afterwards with their email + new password.
    const account = await this.authService.activateAccount(
      dto.token,
      dto.password,
      ipAddress,
      userAgent,
    );
    this.logger.log(`Account activated: ${account.email}`);

    return {
      success: true,
      message: 'Password set successfully. Please login.',
      account,
    };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await this.authService.createPasswordResetToken(
      dto.email,
      ipAddress,
      userAgent,
    );

    if (result) {
      const resetUrl = `${this.frontendUrl}/reset-password?token=${result.token}`;
      await this.emailService.sendPasswordResetEmail({
        to: result.account.email,
        name: result.account.display_name,
        resetUrl,
        expiresAt: result.expiresAt,
      });
    }

    // Always succeed — never reveal whether the email exists.
    return {
      success: true,
      message: 'If an account exists for that email, a reset link has been sent.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    await this.authService.resetPassword(dto.token, dto.password, ipAddress, userAgent);
    return { success: true, message: 'Password has been reset. You can now sign in.' };
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

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionToken = req.cookies?.['c1x_session'];
    const user = req.user;
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (sessionToken) {
      await this.authService.logout(sessionToken, user?.id, ipAddress, userAgent);
    }

    const cookieOptions: any = { path: '/' };
    if (this.cookieDomain && this.cookieDomain !== 'localhost') {
      cookieOptions.domain = this.cookieDomain;
    }
    res.clearCookie('c1x_session', cookieOptions);

    return { success: true };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const oldToken = req.cookies?.['c1x_session'];
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
      const cookieOptions: any = { path: '/' };
      if (this.cookieDomain && this.cookieDomain !== 'localhost') {
        cookieOptions.domain = this.cookieDomain;
      }
      res.clearCookie('c1x_session', cookieOptions);
      return { success: false };
    }
  }

  @Get('me')
  async me(@Req() req: Request) {
    return { success: true, account: req.user };
  }

  // ── Private helpers ────────────────────────────

  private setSessionCookie(res: Response, sessionToken: string): void {
    const cookieOptions: any = {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.sessionTtlHours * 60 * 60 * 1000, // ms
    };

    if (this.cookieDomain && this.cookieDomain !== 'localhost') {
      cookieOptions.domain = this.cookieDomain;
    }

    res.cookie('c1x_session', sessionToken, cookieOptions);
  }
}
