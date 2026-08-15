import { RESEND_URL } from '#constant';
import type { Mailer } from './resend.type';

export function resendMailer(apiKey: string, from: string, fetchFn: typeof fetch = fetch): Mailer {
  return {
    send: async (mail) => {
      const res = await fetchFn(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, ...mail }),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    },
  };
}

export const consoleMailer: Mailer = {
  send: async (mail) => {
    console.log(`[mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
  },
};
