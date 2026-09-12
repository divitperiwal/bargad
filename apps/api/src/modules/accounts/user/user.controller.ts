import { deleteAccountSchema, updateProfileSchema } from '@bargad/shared';
import { deleteCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '#constant';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { sendSuccess } from '#utils/http/response.util';
import { UserService } from './user.service';

export const UserController = {
  profile: createHandlers(async (c) => sendSuccess(c, { user: await UserService.getProfile(c.var.user.id) })),

  update: createHandlers(validate('json', updateProfileSchema), async (c) =>
    sendSuccess(c, { user: await UserService.updateProfile(c.var.user.id, c.req.valid('json')) }),
  ),

  remove: createHandlers(validate('json', deleteAccountSchema), async (c) => {
    await UserService.deleteAccount(c.var.user.id, c.req.valid('json'));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return sendSuccess(c, { deleted: true });
  }),
};
