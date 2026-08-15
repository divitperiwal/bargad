import { describe, expect, test } from 'bun:test';
import { signupSchema } from '@bargad/shared';

const valid = {
  displayName: 'Asha Rao',
  email: 'asha@example.com',
  mobile: '9876543210',
  dateOfBirth: '1990-05-17',
  password: 'correct horse battery',
  acceptTerms: true,
  client: 'web',
};

function yearsAgo(years: number, extraDays = 0) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + extraDays);
  return d.toISOString().slice(0, 10);
}

describe('signupSchema', () => {
  test('parses a valid body and lowercases the trimmed email', () => {
    const parsed = signupSchema.parse({ ...valid, email: ' Asha@Example.com ' });
    expect(parsed.email).toBe('asha@example.com');
  });

  test.each([
    ['a 9-character password', { password: '123456789' }, 'password'],
    ['a short mobile number', { mobile: '12345' }, 'mobile'],
    ['17 years and 364 days old', { dateOfBirth: yearsAgo(18, 1) }, 'dateOfBirth'],
    ['an impossible date', { dateOfBirth: '2000-02-30' }, 'dateOfBirth'],
    ['terms not accepted', { acceptTerms: false }, 'acceptTerms'],
    ['an unknown client', { client: 'desktop' }, 'client'],
  ])('rejects %s', (_name, override, field) => {
    const result = signupSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === field)).toBe(true);
  });

  test('accepts someone who turned 18 today', () => {
    expect(signupSchema.safeParse({ ...valid, dateOfBirth: yearsAgo(18) }).success).toBe(true);
  });
});
