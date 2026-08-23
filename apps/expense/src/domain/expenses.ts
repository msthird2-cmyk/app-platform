import { monthKey } from '@platform/utils';

export const EXPENSE_CATEGORIES = [
  'groceries',
  'dining',
  'transport',
  'utilities',
  'rent',
  'health',
  'entertainment',
  'shopping',
  'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: ExpenseCategory;
  date: Date;
}

export interface CategoryRule {
  /** Matched case-insensitively against the description. */
  keyword: string;
  category: ExpenseCategory;
}

export const DEFAULT_RULES: readonly CategoryRule[] = [
  { keyword: 'uber', category: 'transport' },
  { keyword: 'ola', category: 'transport' },
  { keyword: 'metro', category: 'transport' },
  { keyword: 'swiggy', category: 'dining' },
  { keyword: 'zomato', category: 'dining' },
  { keyword: 'restaurant', category: 'dining' },
  { keyword: 'bigbasket', category: 'groceries' },
  { keyword: 'grocer', category: 'groceries' },
  { keyword: 'electricity', category: 'utilities' },
  { keyword: 'broadband', category: 'utilities' },
  { keyword: 'pharmacy', category: 'health' },
  { keyword: 'hospital', category: 'health' },
  { keyword: 'netflix', category: 'entertainment' },
  { keyword: 'rent', category: 'rent' },
];

/**
 * Rule-based first: a longer keyword wins over a shorter one, so "bigbasket"
 * beats a generic "basket" rule regardless of the order rules were added.
 */
export function categorize(
  description: string,
  rules: readonly CategoryRule[] = DEFAULT_RULES,
): ExpenseCategory {
  const haystack = description.toLowerCase();
  let best: CategoryRule | null = null;
  for (const rule of rules) {
    if (!haystack.includes(rule.keyword.toLowerCase())) continue;
    if (!best || rule.keyword.length > best.keyword.length) best = rule;
  }
  return best?.category ?? 'other';
}

export interface Budget {
  category: ExpenseCategory;
  monthlyLimit: number;
}

export interface BudgetStatus {
  category: ExpenseCategory;
  limit: number;
  spent: number;
  remaining: number;
  /** Fraction of the limit used; can exceed 1. */
  usage: number;
  state: 'under' | 'near' | 'over';
}

export function spentByCategory(expenses: readonly Expense[]): Map<ExpenseCategory, number> {
  const totals = new Map<ExpenseCategory, number>();
  for (const expense of expenses) {
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
  }
  return totals;
}

export function budgetStatus(budget: Budget, expenses: readonly Expense[]): BudgetStatus {
  const spent = spentByCategory(expenses).get(budget.category) ?? 0;
  const usage = budget.monthlyLimit === 0 ? 0 : spent / budget.monthlyLimit;
  const state: BudgetStatus['state'] = usage > 1 ? 'over' : usage >= 0.8 ? 'near' : 'under';
  return {
    category: budget.category,
    limit: budget.monthlyLimit,
    spent,
    remaining: budget.monthlyLimit - spent,
    usage,
    state,
  };
}

export function expensesForMonth(expenses: readonly Expense[], month: Date): Expense[] {
  const key = monthKey(month);
  return expenses.filter((expense) => monthKey(expense.date) === key);
}

export interface MonthlyTotal {
  month: string;
  total: number;
}

export function monthlyTotals(expenses: readonly Expense[]): MonthlyTotal[] {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    const key = monthKey(expense.date);
    totals.set(key, (totals.get(key) ?? 0) + expense.amount);
  }
  return [...totals.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Average of the completed months only, so a partial month cannot skew it. */
export function averageMonthlySpend(expenses: readonly Expense[], currentMonth: Date): number {
  const current = monthKey(currentMonth);
  const completed = monthlyTotals(expenses).filter((entry) => entry.month !== current);
  if (completed.length === 0) return 0;
  return completed.reduce((sum, entry) => sum + entry.total, 0) / completed.length;
}
