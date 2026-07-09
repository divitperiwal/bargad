import { z } from 'zod';
import { assertionSchema } from './passkey';

export const brokers = ['dhan', 'mstock', 'fake'] as const;

const text40 = z.string().trim().min(1).max(40);

export const linkBrokerAccountSchema = z.object({
  broker: z.enum(brokers),
  brokerClientId: text40,
  label: text40,
});

export const updateBrokerAccountSchema = z
  .object({
    label: text40.optional(),
    hidden: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export const setCredentialsSchema = z.object({
  pin: z.string().regex(/^\d{4,12}$/),
  totpSecret: z.string().regex(/^[A-Za-z2-7]{16,64}$/),
  assertion: assertionSchema,
});

export type LinkBrokerAccountInput = z.infer<typeof linkBrokerAccountSchema>;
export type UpdateBrokerAccountInput = z.infer<typeof updateBrokerAccountSchema>;
export type SetCredentialsInput = z.infer<typeof setCredentialsSchema>;
