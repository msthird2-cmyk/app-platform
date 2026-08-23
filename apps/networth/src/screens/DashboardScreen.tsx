import { View, StyleSheet } from 'react-native';
import { AppText, Card, ListRow, ProgressBar, Screen, EmptyState } from '@platform/ui';
import { spacing } from '@platform/theme';
import { formatCurrency, formatPercent } from '@platform/utils';
import {
  allocationByCategory,
  computeNetWorth,
  debtToAssetRatio,
  netWorthChange,
  type Asset,
  type Liability,
} from '../domain/assets';

const CATEGORY_LABELS: Record<string, string> = {
  cash: 'Cash',
  deposits: 'Deposits',
  equity: 'Equity',
  mutualFunds: 'Mutual funds',
  retirement: 'Retirement',
  property: 'Property',
  gold: 'Gold',
  other: 'Other',
};

export interface DashboardScreenProps {
  assets: readonly Asset[];
  liabilities: readonly Liability[];
  previousNetWorth: number | null;
  onAddAsset: () => void;
}

export function DashboardScreen({
  assets,
  liabilities,
  previousNetWorth,
  onAddAsset,
}: DashboardScreenProps) {
  const netWorth = computeNetWorth(assets, liabilities);
  const allocation = allocationByCategory(assets);
  const change = previousNetWorth === null ? null : netWorthChange(previousNetWorth, netWorth.net);

  if (assets.length === 0 && liabilities.length === 0) {
    return (
      <Screen title="Net worth">
        <EmptyState
          title="Nothing tracked yet"
          description="Add what you own and what you owe to see your net worth."
          actionLabel="Add asset"
          onAction={onAddAsset}
        />
      </Screen>
    );
  }

  return (
    <Screen title={formatCurrency(netWorth.net)} subtitle="Net worth">
      {change ? (
        <AppText variant="meta" tone={change.absolute >= 0 ? 'up' : 'down'} numeric>
          {`${change.absolute >= 0 ? '+' : ''}${formatCurrency(change.absolute)} (${formatPercent(change.ratio)})`}
        </AppText>
      ) : null}

      <Card>
        <View style={styles.row}>
          <AppText variant="body">Assets</AppText>
          <AppText variant="body" numeric>
            {formatCurrency(netWorth.assets)}
          </AppText>
        </View>
        <View style={styles.row}>
          <AppText variant="body">Liabilities</AppText>
          <AppText variant="body" tone="down" numeric>
            {formatCurrency(netWorth.liabilities)}
          </AppText>
        </View>
        <ProgressBar
          progress={debtToAssetRatio(netWorth)}
          tone={debtToAssetRatio(netWorth) > 0.5 ? 'warn' : 'accent'}
          label="Debt to asset ratio"
        />
        <AppText variant="meta" tone="muted">
          {`Debt is ${formatPercent(debtToAssetRatio(netWorth))} of assets`}
        </AppText>
      </Card>

      <View style={styles.section}>
        <AppText variant="title">Allocation</AppText>
        {allocation.map((entry) => (
          <ListRow
            key={entry.category}
            title={CATEGORY_LABELS[entry.category] ?? entry.category}
            meta={formatPercent(entry.share)}
            value={formatCurrency(entry.value)}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  section: { gap: spacing.xs, marginTop: spacing.lg },
});
