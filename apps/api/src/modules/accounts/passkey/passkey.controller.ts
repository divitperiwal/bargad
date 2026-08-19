import {
  managePasskeySchema,
  passkeyLoginSchema,
  registerPasskeySchema,
  renamePasskeySchema,
  stepUpChallengeSchema,
} from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { respondSignedIn } from '#modules/accounts/auth/auth.helper';
import { createHandlers } from '#utils/http/handler.util';
import { idParam } from '#utils/http/param.util';
import { sendSuccess } from '#utils/http/response.util';
import { PasskeyService } from './passkey.service';

export const PasskeyController = {
  loginOptions: createHandlers(async (c) => sendSuccess(c, await PasskeyService.loginOptions())),

  login: createHandlers(validate('json', passkeyLoginSchema), async (c) => {
    const input = c.req.valid('json');
    return respondSignedIn(c, input.client, await PasskeyService.login(input), 200);
  }),

  registrationOptions: createHandlers(validate('json', managePasskeySchema), async (c) =>
    sendSuccess(c, await PasskeyService.registrationOptions(c.var.user, c.req.valid('json'))),
  ),

  register: createHandlers(validate('json', registerPasskeySchema), async (c) => {
    const passkey = await PasskeyService.register(c.var.user.id, c.req.valid('json'));
    return sendSuccess(c, { passkey }, 201);
  }),

  stepUpChallenge: createHandlers(validate('json', stepUpChallengeSchema), async (c) =>
    sendSuccess(c, await PasskeyService.stepUpChallenge(c.var.user.id, c.req.valid('json'))),
  ),

  list: createHandlers(async (c) => sendSuccess(c, { items: await PasskeyService.list(c.var.user.id) })),

  rename: createHandlers(validate('param', idParam), validate('json', renamePasskeySchema), async (c) => {
    const passkey = await PasskeyService.rename(c.var.user.id, c.req.valid('param').id, c.req.valid('json'));
    return sendSuccess(c, { passkey });
  }),

  remove: createHandlers(validate('param', idParam), validate('json', managePasskeySchema), async (c) => {
    await PasskeyService.remove(c.var.user.id, c.req.valid('param').id, c.req.valid('json'));
    return sendSuccess(c, { deleted: true });
  }),
};
