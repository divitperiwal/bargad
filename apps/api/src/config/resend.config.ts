import { consoleMailer, resendMailer } from '#integrations/resend/resend.client';
import type { Mailer } from '#integrations/resend/resend.type';
import { env } from './env.config';

let current: Mailer = env.RESEND_API_KEY ? resendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : consoleMailer;

export const getMailer = () => current;
export const setMailer = (mailer: Mailer) => {
  current = mailer;
};
