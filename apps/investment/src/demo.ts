import type { Holding } from './domain/portfolio';

export const DEMO_HOLDINGS: Holding[] = [
  {
    id: 'h1',
    name: 'Nifty 50 index fund',
    kind: 'mutualFund',
    currentPrice: 142.4,
    transactions: [
      { id: 't1', units: 4000, pricePerUnit: 96.2, date: new Date('2022-04-11T00:00:00Z') },
      { id: 't2', units: 2500, pricePerUnit: 118.7, date: new Date('2023-06-05T00:00:00Z') },
    ],
  },
  {
    id: 'h2',
    name: 'Midcap fund',
    kind: 'mutualFund',
    currentPrice: 78.9,
    transactions: [
      { id: 't3', units: 3000, pricePerUnit: 61.4, date: new Date('2022-09-19T00:00:00Z') },
      { id: 't4', units: -800, pricePerUnit: 84.1, date: new Date('2024-02-02T00:00:00Z') },
    ],
  },
  {
    id: 'h3',
    name: 'Global equity ETF',
    kind: 'etf',
    currentPrice: 214.0,
    transactions: [{ id: 't5', units: 900, pricePerUnit: 232.5, date: new Date('2023-11-27T00:00:00Z') }],
  },
];
