import { uuidSchema } from '@bargad/shared';
import { z } from 'zod';

export const idParam = z.object({ id: uuidSchema });
export const memberIdParam = z.object({ memberId: uuidSchema });
export const userIdParam = z.object({ userId: uuidSchema });
