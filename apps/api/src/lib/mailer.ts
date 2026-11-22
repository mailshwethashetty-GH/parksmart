/**
 * Email transport (docs/06: Nodemailer over SMTP, or Amazon SES Mumbai via SMTP).
 * Without SMTP settings, emails are logged instead of sent (development).
 */
import nodemailer from 'nodemailer';

export type Email = { to: string; subject: string; text: string };

export interface Mailer {
  send(email: Email): Promise<void>;
}

export function createMailer(opts: {
  host?: string;
  port: number;
  user?: string;
  pass?: string;
  from?: string;
  log: (msg: string, data?: unknown) => void;
}): Mailer {
  if (!opts.host || !opts.from) {
    return {
      async send(email) {
        opts.log('email (not sent: SMTP not configured)', { to: email.to, subject: email.subject });
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.port === 465,
    auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
  });
  return {
    async send(email) {
      await transport.sendMail({ from: opts.from, ...email });
    },
  };
}
