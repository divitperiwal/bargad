import { z } from 'zod';
import { paiseSchema } from './common';

export const assetTypes = [
  'bank_cash',
  'fd',
  'epf_ppf_nps',
  'gold',
  'real_estate',
  'vehicle',
  'other',
] as const;
export const liabilityTypes = [
  'home_loan',
  'car_loan',
  'personal_loan',
  'education_loan',
  'credit_card',
] as const;

const todayInIndia = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

// YYYY-MM-DD compares correctly as text; "today" is the calendar day in India.
const asOfSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  // Date.parse rolls 2026-02-31 into March, so check that the date survives a round trip.
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Not a real date')
  .refine((value) => value <= todayInIndia(), 'Cannot be in the future');

const nameSchema = z.string().trim().min(1).max(80);
const rateSchema = z.number().int().min(0).max(10_000);

const common = {
  name: nameSchema,
  valuePaise: paiseSchema,
  asOf: asOfSchema,
  hidden: z.boolean().default(false),
};

export const ledgerEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('asset'),
    type: z.enum(assetTypes),
    ...common,
    // Named so a stray loan field is reported against its own name.
    emiPaise: z.never({ error: 'Only loans have an EMI' }).optional(),
    interestRateBps: z.never({ error: 'Only loans have an interest rate' }).optional(),
  }),
  z.strictObject({
    kind: z.literal('liability'),
    type: z.enum(liabilityTypes),
    ...common,
    emiPaise: paiseSchema.optional(),
    interestRateBps: rateSchema.optional(),
  }),
]);

// The service merges this over the stored entry and validates the result against ledgerEntrySchema.
// null clears a loan's EMI or interest rate.
export const updateLedgerEntrySchema = z
  .strictObject({
    type: z.enum([...assetTypes, ...liabilityTypes]).optional(),
    name: nameSchema.optional(),
    valuePaise: paiseSchema.optional(),
    asOf: asOfSchema.optional(),
    hidden: z.boolean().optional(),
    emiPaise: paiseSchema.nullable().optional(),
    interestRateBps: rateSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export type LedgerEntryInput = z.infer<typeof ledgerEntrySchema>;
export type UpdateLedgerEntryInput = z.infer<typeof updateLedgerEntrySchema>;
