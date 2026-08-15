import { describe, expect, test } from 'bun:test';
import { resendMailer } from '#integrations/resend/resend.client';

const mail = { to: 'asha@example.com', subject: 'Hello', text: 'Body' };

describe('resendMailer', () => {
  test('posts the mail to Resend with the bearer key', async () => {
    let url = '';
    let init: RequestInit = {};
    const fetchFn = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await resendMailer('k', 'Bargad <a@b.test>', fetchFn).send(mail);

    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toEqual({ from: 'Bargad <a@b.test>', ...mail });
  });

  test('rejects when Resend answers with an error status', async () => {
    const fetchFn = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;

    await expect(resendMailer('k', 'from@b.test', fetchFn).send(mail)).rejects.toThrow();
  });
});
