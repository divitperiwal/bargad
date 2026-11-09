import { createGrantSchema, listGrantsQuerySchema } from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { idParam } from '#utils/http/param.util';
import { sendSuccess } from '#utils/http/response.util';
import { GrantService } from './grant.service';

export const GrantController = {
  list: createHandlers(validate('query', listGrantsQuerySchema), async (c) =>
    sendSuccess(c, await GrantService.list(c.var.user.id, c.req.valid('query'))),
  ),

  create: createHandlers(validate('json', createGrantSchema), async (c) => {
    const grant = await GrantService.create(c.var.user, c.req.valid('json'));
    return sendSuccess(c, { grant }, 201);
  }),

  revoke: createHandlers(validate('param', idParam), async (c) =>
    sendSuccess(c, { grant: await GrantService.revoke(c.var.user, c.req.valid('param').id) }),
  ),
};
