import { forgotPasswordSchema, loginSchema, resetPasswordSchema, signupSchema } from '@bargad/shared';
import { deleteCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '#constant';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { sendSuccess } from '#utils/http/response.util';
import { respondSignedIn } from './auth.helper';
import { AuthService } from './auth.service';
import { ResetService } from './reset.service';

export const AuthController = {
  signup: createHandlers(validate('json', signupSchema), async (c) => {
    const input = c.req.valid('json');
    return respondSignedIn(c, input.client, await AuthService.signup(input), 201);
  }),

  login: createHandlers(validate('json', loginSchema), async (c) => {
    const input = c.req.valid('json');
    return respondSignedIn(c, input.client, await AuthService.login(input), 200);
  }),

  logout: createHandlers(async (c) => {
    await AuthService.logout(c.var.sessionHash);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return sendSuccess(c, { signedOut: true });
  }),

  forgotPassword: createHandlers(validate('json', forgotPasswordSchema), async (c) => {
    await ResetService.forgot(c.req.valid('json'));
    return sendSuccess(c, { sent: true });
  }),

  resetPassword: createHandlers(validate('json', resetPasswordSchema), async (c) => {
    await ResetService.reset(c.req.valid('json'));
    return sendSuccess(c, { reset: true });
  }),

  me: createHandlers((c) => sendSuccess(c, { user: c.var.user })),
};
