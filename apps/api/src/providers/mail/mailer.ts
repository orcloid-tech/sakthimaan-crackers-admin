import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../config/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Provider-agnostic mail interface (password resets, admin alerts). */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development/test: logs the message (and keeps it in memory for tests). */
export class ConsoleMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  constructor(private readonly logger: Logger) {}

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    this.logger.info(
      { to: message.to, subject: message.subject, text: message.text },
      'Email (console mailer)',
    );
  }
}

/** Any SMTP server (Gmail/Zoho/hosting provider). No paid provider required. */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    env: Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASS'>,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

export function createMailer(env: Env, logger: Logger): Mailer {
  return env.MAIL_PROVIDER === 'smtp' ? new SmtpMailer(env, env.MAIL_FROM) : new ConsoleMailer(logger);
}
