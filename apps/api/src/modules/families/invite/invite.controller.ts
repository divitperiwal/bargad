import { inviteMemberSchema, inviteTokenParam } from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { idParam } from '#utils/http/param.util';
import { sendSuccess } from '#utils/http/response.util';
import { InviteService } from './invite.service';

export const InviteController = {
  send: createHandlers(validate('json', inviteMemberSchema), async (c) => {
    const invite = await InviteService.send(c.var.user, c.req.valid('json'));
    return sendSuccess(c, { invite }, 201);
  }),

  listPending: createHandlers(async (c) => sendSuccess(c, { items: await InviteService.listPending(c.var.user.id) })),

  revoke: createHandlers(validate('param', idParam), async (c) => {
    await InviteService.revoke(c.var.user.id, c.req.valid('param').id);
    return sendSuccess(c, { revoked: true });
  }),

  preview: createHandlers(validate('param', inviteTokenParam), async (c) =>
    sendSuccess(c, { invite: await InviteService.preview(c.req.valid('param').token) }),
  ),

  accept: createHandlers(validate('param', inviteTokenParam), async (c) =>
    sendSuccess(c, await InviteService.accept(c.var.user, c.req.valid('param').token), 201),
  ),
};
