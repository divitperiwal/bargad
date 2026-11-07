import { instrumentSearchSchema } from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { sendSuccess } from '#utils/http/response.util';
import { InstrumentService } from './instrument.service';

export const InstrumentController = {
  search: createHandlers(validate('query', instrumentSearchSchema), async (c) =>
    sendSuccess(c, { items: await InstrumentService.search(c.req.valid('query').q) }),
  ),
};
