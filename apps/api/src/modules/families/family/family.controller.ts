import { createFamilySchema, handoverSchema } from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { MemberService } from '#modules/families/member/member.service';
import { createHandlers } from '#utils/http/handler.util';
import { sendSuccess } from '#utils/http/response.util';
import { FamilyService } from './family.service';

export const FamilyController = {
  create: createHandlers(validate('json', createFamilySchema), async (c) =>
    sendSuccess(c, await FamilyService.create(c.var.user.id, c.req.valid('json')), 201),
  ),

  current: createHandlers(async (c) => sendSuccess(c, await FamilyService.current(c.var.user.id))),

  dissolve: createHandlers(async (c) => {
    await MemberService.dissolve(c.var.user.id);
    return sendSuccess(c, { dissolved: true });
  }),

  handover: createHandlers(validate('json', handoverSchema), async (c) => {
    await MemberService.handover(c.var.user.id, c.req.valid('json'));
    return sendSuccess(c, await FamilyService.current(c.var.user.id));
  }),
};
