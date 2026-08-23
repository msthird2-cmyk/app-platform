/**
 * Net worth is this application's business domain — it lives here, never in
 * packages/. Everything below is pure and unit-tested.
 */
export const ASSET_CATEGORIES = [
  'cash',
  'deposits',
  'equity',
  'mutualFunds',
  'retirement',
  'property',
  'gold',
  'other',
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const LIABILITY_CATEGORIES = ['homeLoan', 'personalLoan', 'creditCard', 'other'] as const;

export type LiabilityCategory = (typeof LIABILITY_CATEGORIES)[number];

export interface Asset {
  id: string;
  name: string;
  category: AssetCategory;
  value: number;
  /** Assets held in a spouse's or joint name can be excluded from the total. */
  includeInNetWorth: boolean;
}

export interface Liability {
  id: string;
  name: string;
  category: LiabilityCategory;
  outstanding: number;
}

export interface NetWorth {
  assets: number;
  liabilities: number;
  net: number;
}

export function totalAssets(assets: readonly Asset[]): number {
  return assets
    .filter((asset) => asset.includeInNetWorth)
    .reduce((sum, asset) => sum + asset.value, 0);
}

export function totalLiabilities(liabilities: readonly Liability[]): number {
  return liabilities.reduce((sum, liability) => sum + liability.outstanding, 0);
}

export function computeNetWorth(assets: readonly Asset[], liabilities: readonly Liability[]): NetWorth {
  const assetTotal = totalAssets(assets);
  const liabilityTotal = totalLiabilities(liabilities);
  return { assets: assetTotal, liabilities: liabilityTotal, net: assetTotal - liabilityTotal };
}

export interface CategoryAllocation {
  category: AssetCategory;
  value: number;
  /** Share of total assets, 0…1. Zero when there is nothing to allocate. */
  share: number;
}

export function allocationByCategory(assets: readonly Asset[]): CategoryAllocation[] {
  const total = totalAssets(assets);
  const sums = new Map<AssetCategory, number>();
  for (const asset of assets) {
    if (!asset.includeInNetWorth) continue;
    sums.set(asset.category, (sums.get(asset.category) ?? 0) + asset.value);
  }
  return [...sums.entries()]
    .map(([category, value]) => ({ category, value, share: total === 0 ? 0 : value / total }))
    .sort((a, b) => b.value - a.value);
}

/** Liabilities as a share of assets; a common solvency check. */
export function debtToAssetRatio(netWorth: NetWorth): number {
  return netWorth.assets === 0 ? 0 : netWorth.liabilities / netWorth.assets;
}

export function netWorthChange(previous: number, current: number): { absolute: number; ratio: number } {
  const absolute = current - previous;
  const ratio = previous === 0 ? 0 : absolute / Math.abs(previous);
  return { absolute, ratio };
}
