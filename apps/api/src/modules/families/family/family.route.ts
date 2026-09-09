import { Hono } from 'hono';
import { requireUser } from '#middlewares/auth.middleware';
import { familyInviteRoutes } from '#modules/families/invite/invite.route';
import { memberRoutes } from '#modules/families/member/member.route';
import type { AuthEnv } from '#types/hono.types';
import { FamilyController } from './family.controller';

export const familyRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  .post('/', ...FamilyController.create)
  .get('/current', ...FamilyController.current)
  .delete('/current', ...FamilyController.dissolve)
  .post('/current/handover', ...FamilyController.handover)
  .route('/current/members', memberRoutes)
  .route('/current/invites', familyInviteRoutes);
