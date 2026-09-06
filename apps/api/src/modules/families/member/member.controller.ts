import { declareRelationshipSchema } from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { memberIdParam } from '#utils/http/param.util';
import { sendSuccess } from '#utils/http/response.util';
import { MemberService } from './member.service';

export const MemberController = {
  leave: createHandlers(async (c) => {
    await MemberService.leave(c.var.user.id);
    return sendSuccess(c, { left: true });
  }),

  declareRelationship: createHandlers(validate('json', declareRelationshipSchema), async (c) => {
    const me = await MemberService.declareRelationship(c.var.user.id, c.req.valid('json'));
    return sendSuccess(c, { me });
  }),

  remove: createHandlers(validate('param', memberIdParam), async (c) => {
    await MemberService.remove(c.var.user.id, c.req.valid('param').memberId);
    return sendSuccess(c, { removed: true });
  }),
};
