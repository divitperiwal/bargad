import { instruments } from '#database/schema';

export const instrumentColumns = {
  id: instruments.id,
  exchange: instruments.exchange,
  tradingSymbol: instruments.tradingSymbol,
  isin: instruments.isin,
  name: instruments.name,
  tickSizePaise: instruments.tickSizePaise,
  lotSize: instruments.lotSize,
};

// LIKE treats these as wildcards; a symbol search means them literally.
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);
