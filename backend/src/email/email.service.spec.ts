// ──────────────────────────────────────────────
// EmailService unit tests (transport mocked)
// ──────────────────────────────────────────────

import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';

jest.mock('nodemailer');

describe('EmailService', () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
  const verify = jest.fn().mockResolvedValue(true);

  beforeEach(() => {
    sendMail.mockClear();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail, verify });
  });

  function configured() {
    const map: Record<string, string> = {
      SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587',
      SMTP_USERNAME: 'user@example.com', SMTP_PASSWORD: 'pw',
      SMTP_FROM_EMAIL: 'noreply@example.com', SMTP_FROM_NAME: 'DataIntel',
    };
    return { get: jest.fn((k: string, def?: any) => map[k] ?? def) } as any;
  }

  it('sends an invitation email with the activation link and role', async () => {
    const svc = new EmailService(configured());
    await svc.sendInvitationEmail({
      to: 'jane@company.com', name: 'Jane', role: 'ANALYST',
      activationUrl: 'http://localhost:3000/activate?token=abc',
      expiresAt: new Date('2026-06-26T00:00:00Z'),
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const msg = sendMail.mock.calls[0][0];
    expect(msg.to).toBe('jane@company.com');
    expect(msg.html).toContain('http://localhost:3000/activate?token=abc');
    expect(msg.html).toContain('ANALYST');
    expect(msg.from).toContain('noreply@example.com');
  });

  it('marks resent invitations in the subject', async () => {
    const svc = new EmailService(configured());
    await svc.sendInvitationEmail({
      to: 'jane@company.com', name: 'Jane', role: 'VIEWER',
      activationUrl: 'http://x/activate?token=abc', expiresAt: new Date(), resend: true,
    });
    expect(sendMail.mock.calls[0][0].subject).toMatch(/resent/i);
  });

  it('sends a password reset email with the reset link', async () => {
    const svc = new EmailService(configured());
    await svc.sendPasswordResetEmail({
      to: 'jane@company.com', name: 'Jane',
      resetUrl: 'http://localhost:3000/reset-password?token=rt', expiresAt: new Date(),
    });
    expect(sendMail.mock.calls[0][0].html).toContain('reset-password?token=rt');
  });

  it('escapes HTML in user-provided fields', async () => {
    const svc = new EmailService(configured());
    await svc.sendInvitationEmail({
      to: 'x@y.com', name: '<script>alert(1)</script>', role: 'VIEWER',
      activationUrl: 'http://x/a', expiresAt: new Date(),
    });
    const html = sendMail.mock.calls[0][0].html as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('verifies the SMTP transport on init when configured', async () => {
    const svc = new EmailService(configured());
    await svc.onModuleInit();
    expect(verify).toHaveBeenCalled();
  });

  it('skips verification when SMTP is not configured', async () => {
    verify.mockClear();
    const svc = new EmailService({ get: jest.fn((_k, def) => def) } as any);
    await svc.onModuleInit();
    expect(verify).not.toHaveBeenCalled();
  });

  it('does not throw when SMTP is not configured (dev fallback)', async () => {
    const svc = new EmailService({ get: jest.fn((_k, def) => def) } as any);
    await expect(
      svc.sendPasswordResetEmail({ to: 'a@b.com', name: 'A', resetUrl: 'http://x', expiresAt: new Date() }),
    ).resolves.toBeUndefined();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
