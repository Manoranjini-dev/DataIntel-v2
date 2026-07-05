// ──────────────────────────────────────────────
// Email Service — SMTP delivery via nodemailer
// Reusable across invitation / activation / password-reset flows.
// ──────────────────────────────────────────────

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface InvitationEmailParams {
  to: string;
  name: string;
  role: string;
  activationUrl: string;
  expiresAt: Date;
  resend?: boolean;
}

export interface PasswordResetEmailParams {
  to: string;
  name: string;
  resetUrl: string;
  expiresAt: Date;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT', '587'));
    const user = this.config.get<string>('SMTP_USERNAME');
    const pass = this.config.get<string>('SMTP_PASSWORD');

    this.fromEmail = this.config.get<string>('SMTP_FROM_EMAIL', user || 'no-reply@dataintel.local');
    this.fromName = this.config.get<string>('SMTP_FROM_NAME', 'DataIntel');
    this.enabled = Boolean(host && user && pass);

    if (this.enabled) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465, // 465 = implicit TLS; 587 uses STARTTLS
        auth: { user, pass },
      });
    } else {
      this.logger.warn('SMTP not fully configured — emails will be logged, not sent.');
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.transporter) {
      this.transporter.verify().then(() => {
        this.logger.log('SMTP transport verified.');
      }).catch((err) => {
        this.logger.error(`SMTP verification failed: ${err}`);
      });
    }
  }

  /** Invitation / resend-invitation email with an activation link. */
  async sendInvitationEmail(params: InvitationEmailParams): Promise<void> {
    const subject = params.resend
      ? 'Your DataIntel invitation (resent)'
      : "You've been invited to DataIntel";

    const html = this.layout(`
      <h2 style="margin:0 0 16px;color:#111827;">Hello ${this.esc(params.name)},</h2>
      <p style="margin:0 0 16px;color:#374151;line-height:1.6;">
        You have been invited to join <strong>DataIntel</strong> as
        <strong>${this.esc(params.role)}</strong>. Click the button below to set your
        password and activate your account.
      </p>
      ${this.button('Activate your account', params.activationUrl)}
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">
        This invitation expires on <strong>${this.fmt(params.expiresAt)}</strong>.
        If you weren't expecting this, you can safely ignore this email.
      </p>
    `);

    await this.send(params.to, subject, html);
  }

  /** Password-reset email with a reset link. */
  async sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
    const html = this.layout(`
      <h2 style="margin:0 0 16px;color:#111827;">Hello ${this.esc(params.name)},</h2>
      <p style="margin:0 0 16px;color:#374151;line-height:1.6;">
        We received a request to reset your DataIntel password. Click the button
        below to choose a new one.
      </p>
      ${this.button('Reset password', params.resetUrl)}
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">
        This link expires on <strong>${this.fmt(params.expiresAt)}</strong>.
        If you didn't request a reset, no action is needed.
      </p>
    `);

    await this.send(params.to, 'Reset your DataIntel password', html);
  }

  // ── Private helpers ────────────────────────────

  private async send(to: string, subject: string, html: string): Promise<void> {
    const from = `"${this.fromName}" <${this.fromEmail}>`;

    if (!this.transporter) {
      // Dev fallback: log instead of failing the request flow.
      this.logger.log(`[email:dev] To=${to} Subject="${subject}"`);
      return;
    }

    await this.transporter.sendMail({ from, to, subject, html });
    this.logger.log(`Email sent to ${to}: "${subject}"`);
  }

  private layout(inner: string): string {
    return `
      <div style="background:#f3f4f6;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e7eb;">
          <div style="font-size:20px;font-weight:700;color:#D97A1E;margin-bottom:24px;">DataIntel</div>
          ${inner}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px;" />
          <p style="margin:0;color:#9ca3af;font-size:12px;">© DataIntel. This is an automated message.</p>
        </div>
      </div>`;
  }

  private button(label: string, url: string): string {
    return `<a href="${this.esc(url)}" style="display:inline-block;background:linear-gradient(135deg,#D97A1E,#F5A623);color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:600;font-size:14px;">${this.esc(label)}</a>`;
  }

  private fmt(d: Date): string {
    return new Date(d).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  private esc(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
