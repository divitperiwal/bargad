import { describe, expect, test } from 'bun:test';
import { sumSubtotals, toSubtotal } from '#modules/household/overview/valuation.util';

describe('toSubtotal', () => {
  test('adds broker value and assets and takes off liabilities', () => {
    const subtotal = toSubtotal({
      accounts: [
        { marketValuePaise: 120_000, investedPaise: 100_000 },
        { marketValuePaise: 50_000, investedPaise: 40_000 },
      ],
      entries: [
        { kind: 'asset', valuePaise: 20_000 },
        { kind: 'liability', valuePaise: 5_000 },
      ],
    });

    expect(subtotal).toEqual({
      brokerValuePaise: 170_000,
      investedPaise: 140_000,
      assetsPaise: 20_000,
      liabilitiesPaise: 5_000,
      netWorthPaise: 185_000,
    });
  });
});

describe('sumSubtotals', () => {
  test('is all zeros for nobody', () => {
    expect(sumSubtotals([])).toEqual({
      brokerValuePaise: 0,
      investedPaise: 0,
      assetsPaise: 0,
      liabilitiesPaise: 0,
      netWorthPaise: 0,
    });
  });

  test('adds field by field', () => {
    const a = { brokerValuePaise: 10, investedPaise: 8, assetsPaise: 5, liabilitiesPaise: 2, netWorthPaise: 13 };
    const b = { brokerValuePaise: 1, investedPaise: 1, assetsPaise: 1, liabilitiesPaise: 4, netWorthPaise: -2 };

    expect(sumSubtotals([a, b])).toEqual({
      brokerValuePaise: 11,
      investedPaise: 9,
      assetsPaise: 6,
      liabilitiesPaise: 6,
      netWorthPaise: 11,
    });
  });
});
