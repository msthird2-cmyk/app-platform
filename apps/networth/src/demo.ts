import type { Asset, Liability } from './domain/assets';

/**
 * Sample data for the preview build. Production reads the same shapes from the
 * injected repository — nothing here is referenced by the domain logic.
 */
export const DEMO_ASSETS: Asset[] = [
  { id: 'a1', name: 'Savings account', category: 'cash', value: 240000, includeInNetWorth: true },
  { id: 'a2', name: 'Emergency fund', category: 'deposits', value: 500000, includeInNetWorth: true },
  { id: 'a3', name: 'Index fund', category: 'mutualFunds', value: 1850000, includeInNetWorth: true },
  { id: 'a4', name: 'Direct equity', category: 'equity', value: 620000, includeInNetWorth: true },
  { id: 'a5', name: 'EPF', category: 'retirement', value: 940000, includeInNetWorth: true },
  { id: 'a6', name: 'Apartment', category: 'property', value: 7200000, includeInNetWorth: true },
  { id: 'a7', name: 'Sovereign gold bonds', category: 'gold', value: 310000, includeInNetWorth: true },
];

export const DEMO_LIABILITIES: Liability[] = [
  { id: 'l1', name: 'Home loan', category: 'homeLoan', outstanding: 4100000 },
  { id: 'l2', name: 'Card outstanding', category: 'creditCard', outstanding: 48000 },
];

export const DEMO_PREVIOUS_NET_WORTH = 6_900_000;
