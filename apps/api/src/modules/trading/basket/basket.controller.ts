import { approveBasketSchema, createBasketSchema, listBasketsQuerySchema } from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { idParam } from '#utils/http/param.util';
import { sendSuccess } from '#utils/http/response.util';
import { BasketService } from './basket.service';

export const BasketController = {
  list: createHandlers(validate('query', listBasketsQuerySchema), async (c) =>
    sendSuccess(c, await BasketService.list(c.var.user.id, c.req.valid('query'))),
  ),

  get: createHandlers(validate('param', idParam), async (c) =>
    sendSuccess(c, await BasketService.get(c.var.user.id, c.req.valid('param').id)),
  ),

  create: createHandlers(validate('json', createBasketSchema), async (c) => {
    const basket = await BasketService.create(c.var.user, c.req.valid('json'));
    return sendSuccess(c, { basket }, 201);
  }),

  approve: createHandlers(validate('param', idParam), validate('json', approveBasketSchema), async (c) => {
    const basket = await BasketService.approve(c.var.user.id, c.req.valid('param').id, c.req.valid('json'));
    return sendSuccess(c, { basket });
  }),

  reject: createHandlers(validate('param', idParam), async (c) =>
    sendSuccess(c, { basket: await BasketService.reject(c.var.user.id, c.req.valid('param').id) }),
  ),

  cancel: createHandlers(validate('param', idParam), async (c) =>
    sendSuccess(c, { basket: await BasketService.cancel(c.var.user.id, c.req.valid('param').id) }),
  ),
};
