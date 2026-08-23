import { View, StyleSheet } from 'react-native';
import { AppText, Card, EmptyState, ListRow, ProgressBar, Screen } from '@platform/ui';
import { spacing } from '@platform/theme';
import { formatCurrency, formatDate, formatPercent } from '@platform/utils';
import {
  budgetStatus,
  expensesForMonth,
  type Budget,
  type Expense,
} from '../domain/expenses';

const CATEGORY_LABELS: Record<string, string> = {
  groceries: 'Groceries',
  dining: 'Dining',
  transport: 'Transport',
  utilities: 'Utilities',
  rent: 'Rent',
  health: 'Health',
  entertainment: 'Entertainment',
  shopping: 'Shopping',
  other: 'Other',
};

export interface ExpensesScreenProps {
  expenses: readonly Expense[];
  budgets: readonly Budget[];
  month: Date;
  onAddSpend: () => void;
}

export function ExpensesScreen({ expenses, budgets, month, onAddSpend }: ExpensesScreenProps) {
  const forMonth = expensesForMonth(expenses, month);
  const total = forMonth.reduce((sum, expense) => sum + expense.amount, 0);

  if (forMonth.length === 0) {
    return (
      <Screen title="Expenses">
        <EmptyState
          title="Nothing spent this month"
          description="Add a spend to start tracking against your budgets."
          actionLabel="Add spend"
          onAction={onAddSpend}
        />
      </Screen>
    );
  }

  return (
    <Screen title={formatCurrency(total)} subtitle={`Spent in ${formatDate(month)}`}>
      <View style={styles.section}>
        <AppText variant="title">Budgets</AppText>
        {budgets.map((budget) => {
          const status = budgetStatus(budget, forMonth);
          const tone = status.state === 'over' ? 'down' : status.state === 'near' ? 'warn' : 'up';
          return (
            <Card key={budget.category}>
              <View style={styles.row}>
                <AppText variant="body" style={styles.label}>
                  {CATEGORY_LABELS[budget.category] ?? budget.category}
                </AppText>
                <AppText variant="body" tone={tone} numeric>
                  {`${formatCurrency(status.spent)} / ${formatCurrency(status.limit)}`}
                </AppText>
              </View>
              <ProgressBar progress={status.usage} tone={tone} label={`${budget.category} budget`} />
              <AppText variant="meta" tone="muted">
                {`${formatPercent(status.usage)} of budget used`}
              </AppText>
            </Card>
          );
        })}
      </View>

      <View style={styles.section}>
        <AppText variant="title">This month</AppText>
        {forMonth.map((expense) => (
          <ListRow
            key={expense.id}
            title={expense.description}
            meta={`${CATEGORY_LABELS[expense.category] ?? expense.category} · ${formatDate(expense.date)}`}
            value={formatCurrency(expense.amount)}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { fontWeight: '600' },
  section: { gap: spacing.xs, marginTop: spacing.lg },
});
