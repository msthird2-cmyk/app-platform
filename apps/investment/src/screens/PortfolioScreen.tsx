import { View, StyleSheet } from 'react-native';
import { AppText, Card, EmptyState, ListRow, Screen } from '@platform/ui';
import { spacing } from '@platform/theme';
import { formatCurrency, formatPercent } from '@platform/utils';
import { performance, summarize, type Holding } from '../domain/portfolio';

export interface PortfolioScreenProps {
  holdings: readonly Holding[];
  onAddHolding: () => void;
  onSelectHolding: (id: string) => void;
}

export function PortfolioScreen({ holdings, onAddHolding, onSelectHolding }: PortfolioScreenProps) {
  const summary = summarize(holdings);

  if (holdings.length === 0) {
    return (
      <Screen title="Portfolio">
        <EmptyState
          title="No holdings yet"
          description="Add a holding to track how it is performing."
          actionLabel="Add holding"
          onAction={onAddHolding}
        />
      </Screen>
    );
  }

  return (
    <Screen title={formatCurrency(summary.currentValue)} subtitle="Portfolio value">
      <Card>
        <View style={styles.row}>
          <AppText variant="body">Invested</AppText>
          <AppText variant="body" numeric>
            {formatCurrency(summary.invested)}
          </AppText>
        </View>
        <View style={styles.row}>
          <AppText variant="body">Returns</AppText>
          <AppText variant="body" tone={summary.absoluteGain >= 0 ? 'up' : 'down'} numeric>
            {`${formatCurrency(summary.absoluteGain)} (${formatPercent(summary.returnRatio)})`}
          </AppText>
        </View>
      </Card>

      <View style={styles.section}>
        <AppText variant="title">Holdings</AppText>
        {holdings.map((holding) => {
          const result = performance(holding);
          return (
            <ListRow
              key={holding.id}
              title={holding.name}
              meta={`${result.units} units · ${formatPercent(result.returnRatio)}`}
              value={formatCurrency(result.currentValue)}
              valueTone={result.absoluteGain >= 0 ? 'up' : 'down'}
              onPress={() => onSelectHolding(holding.id)}
            />
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  section: { gap: spacing.xs, marginTop: spacing.lg },
});
