export type Subtotal = {
  brokerValuePaise: number;
  investedPaise: number;
  assetsPaise: number;
  liabilitiesPaise: number;
  netWorthPaise: number;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export const toSubtotal = (input: {
  accounts: { marketValuePaise: number; investedPaise: number }[];
  entries: { kind: 'asset' | 'liability'; valuePaise: number }[];
}): Subtotal => {
  const brokerValuePaise = sum(input.accounts.map((a) => a.marketValuePaise));
  const assetsPaise = sum(input.entries.filter((e) => e.kind === 'asset').map((e) => e.valuePaise));
  const liabilitiesPaise = sum(input.entries.filter((e) => e.kind === 'liability').map((e) => e.valuePaise));
  return {
    brokerValuePaise,
    investedPaise: sum(input.accounts.map((a) => a.investedPaise)),
    assetsPaise,
    liabilitiesPaise,
    netWorthPaise: brokerValuePaise + assetsPaise - liabilitiesPaise,
  };
};

export const sumSubtotals = (parts: Subtotal[]): Subtotal => ({
  brokerValuePaise: sum(parts.map((p) => p.brokerValuePaise)),
  investedPaise: sum(parts.map((p) => p.investedPaise)),
  assetsPaise: sum(parts.map((p) => p.assetsPaise)),
  liabilitiesPaise: sum(parts.map((p) => p.liabilitiesPaise)),
  netWorthPaise: sum(parts.map((p) => p.netWorthPaise)),
});
