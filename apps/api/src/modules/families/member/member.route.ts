import { Hono } from 'hono';
import type { AuthEnv } from '#types/hono.types';
import { MemberController } from './member.controller';

export const memberRoutes = new Hono<AuthEnv>()
  // "me" is registered before ":memberId" so it is not read as a member id.
  .delete('/me', ...MemberController.leave)
  .patch('/me', ...MemberController.declareRelationship)
  .delete('/:memberId', ...MemberController.remove);
