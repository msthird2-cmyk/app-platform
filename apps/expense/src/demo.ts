import { categorize, type Budget, type Expense } from './domain/expenses';

const RAW: ReadonlyArray<[string, string, number, string]> = [
  ['e1', 'Swiggy dinner', 780, '2024-03-02'],
  ['e2', 'BigBasket weekly', 3240, '2024-03-03'],
  ['e3', 'Uber to office', 260, '2024-03-04'],
  ['e4', 'Electricity bill', 2180, '2024-03-06'],
  ['e5', 'Pharmacy', 640, '2024-03-08'],
  ['e6', 'Netflix', 649, '2024-03-09'],
  ['e7', 'Rent', 32000, '2024-03-01'],
  ['e8', 'Restaurant with family', 2450, '2024-03-12'],
  ['e9', 'Metro card top-up', 500, '2024-03-14'],
];

/** Categories are derived by the same rules the app uses at runtime. */
export const DEMO_EXPENSES: Expense[] = RAW.map(([id, description, amount, date]) => ({
  id,
  description,
  amount,
  category: categorize(description),
  date: new Date(`${date}T00:00:00Z`),
}));

export const DEMO_BUDGETS: Budget[] = [
  { category: 'dining', monthlyLimit: 4000 },
  { category: 'groceries', monthlyLimit: 8000 },
  { category: 'transport', monthlyLimit: 2000 },
  { category: 'utilities', monthlyLimit: 2500 },
];

export const DEMO_MONTH = new Date('2024-03-15T00:00:00Z');
