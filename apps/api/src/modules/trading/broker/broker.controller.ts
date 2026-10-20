import { linkBrokerAccountSchema, setCredentialsSchema, updateBrokerAccountSchema } from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { idParam } from '#utils/http/param.util';
import { sendSuccess } from '#utils/http/response.util';
import { BrokerService } from './broker.service';

export const BrokerController = {
  list: createHandlers(async (c) => sendSuccess(c, { items: await BrokerService.list(c.var.user.id) })),

  link: createHandlers(validate('json', linkBrokerAccountSchema), async (c) => {
    const account = await BrokerService.link(c.var.user.id, c.req.valid('json'));
    return sendSuccess(c, { account }, 201);
  }),

  update: createHandlers(validate('param', idParam), validate('json', updateBrokerAccountSchema), async (c) => {
    const account = await BrokerService.update(c.var.user.id, c.req.valid('param').id, c.req.valid('json'));
    return sendSuccess(c, { account });
  }),

  setCredentials: createHandlers(validate('param', idParam), validate('json', setCredentialsSchema), async (c) =>
    sendSuccess(c, await BrokerService.setCredentials(c.var.user.id, c.req.valid('param').id, c.req.valid('json'))),
  ),

  removeCredentials: createHandlers(validate('param', idParam), async (c) =>
    sendSuccess(c, await BrokerService.removeCredentials(c.var.user.id, c.req.valid('param').id)),
  ),
};
