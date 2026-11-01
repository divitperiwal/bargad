import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { userIdParam } from '#utils/http/param.util';
import { sendSuccess } from '#utils/http/response.util';
import { OverviewService } from './overview.service';

export const OverviewController = {
  get: createHandlers(async (c) => sendSuccess(c, await OverviewService.get(c.var.user.id))),

  member: createHandlers(validate('param', userIdParam), async (c) =>
    sendSuccess(c, await OverviewService.member(c.var.user.id, c.req.valid('param').userId)),
  ),
};
