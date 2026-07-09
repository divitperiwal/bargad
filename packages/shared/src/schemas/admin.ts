import { z } from 'zod';
import { brokers } from './broker-account';

export const setKillSwitchSchema = z
  .object({
    scope: z.enum(['global', 'family', 'broker']),
    scopeKey: z.string(),
    engaged: z.boolean(),
    reason: z.string().trim().min(1).max(200),
  })
  .superRefine(({ scope, scopeKey }, ctx) => {
    const valid =
      scope === 'global'
        ? scopeKey === ''
        : scope === 'family'
          ? z.uuid().safeParse(scopeKey).success
          : (brokers as readonly string[]).includes(scopeKey);
    if (!valid)
      ctx.addIssue({ code: 'custom', path: ['scopeKey'], message: `Not a valid ${scope} key` });
  });

export type SetKillSwitchInput = z.infer<typeof setKillSwitchSchema>;
