import { setKillSwitchSchema } from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { idParam } from '#utils/http/param.util';
import { sendSuccess } from '#utils/http/response.util';
import { AdminService } from './admin.service';

export const AdminController = {
  listKillSwitches: createHandlers(async (c) => sendSuccess(c, { items: await AdminService.listKillSwitches() })),

  setKillSwitch: createHandlers(validate('json', setKillSwitchSchema), async (c) => {
    const killSwitch = await AdminService.setKillSwitch(c.var.user.id, c.req.valid('json'));
    return sendSuccess(c, { killSwitch });
  }),

  revokeCredentials: createHandlers(validate('param', idParam), async (c) =>
    sendSuccess(c, await AdminService.revokeCredentials(c.var.user.id, c.req.valid('param').id)),
  ),
};
