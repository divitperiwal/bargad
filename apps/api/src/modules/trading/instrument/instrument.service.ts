import { InstrumentRepository } from './instrument.repository';

export const InstrumentService = {
  search: (q: string) => InstrumentRepository.searchBySymbolPrefix(q),
};
