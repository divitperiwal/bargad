import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email());
const client = z.enum(['web', 'app']);

const isRealDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

// Latest birth date that is still 18 years old today, as YYYY-MM-DD (which sorts as text).
function latestAdultBirthDate() {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 18);
  return date.toISOString().slice(0, 10);
}

export const signupSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email,
  mobile: z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, 'Enter a real date')
    .refine((value) => value <= latestAdultBirthDate(), 'You must be at least 18'),
  password: z.string().min(10).max(128),
  acceptTerms: z.literal(true),
  client,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  client,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(10).max(128),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
