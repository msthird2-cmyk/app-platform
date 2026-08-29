import { useCallback, useEffect, useState } from 'react';
import { useRepository } from '@platform/core';
import { AppText, Loading, Screen } from '@platform/ui';
import type { Asset, Liability } from '../domain/assets';
import {
  listAssets,
  listLiabilities,
  saveAsset,
  saveLiability,
} from '../data/netWorthRepository';
import { DashboardScreen } from './DashboardScreen';

/**
 * The dashboard, over real records.
 *
 * `DashboardScreen` stays a presentational component that is handed arrays; the
 * loading, the writing and the failure handling live here. That split is why
 * the screen itself needed no change to move from demo constants to encrypted
 * Firestore documents — it never knew where its data came from.
 *
 * `useRepository()` is the only way this reaches persistence, and it refuses to
 * return anything but the encryption boundary. There is no import of
 * `FirebaseRepository` in this application, and no way for one to arrive here.
 */
export interface NetWorthScreenProps {
  /**
   * Records written on first run when the store is empty.
   *
   * The preview build passes the sample portfolio so it still looks like
   * something; production passes nothing and a new user sees the empty state.
   * Either way the records go in through the same encrypted path, so the
   * preview exercises the boundary rather than bypassing it.
   */
  seed?: { assets: readonly Asset[]; liabilities: readonly Liability[] } | undefined;
  previousNetWorth?: number | null;
  now?: () => number;
}

type Status = 'loading' | 'ready' | 'failed';

export function NetWorthScreen({ seed, previousNetWorth = null, now }: NetWorthScreenProps) {
  const repository = useRepository();
  const clock = now ?? (() => Date.now());
  const [assets, setAssets] = useState<Asset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [status, setStatus] = useState<Status>('loading');

  const load = useCallback(async () => {
    const [loadedAssets, loadedLiabilities] = await Promise.all([
      listAssets(repository),
      listLiabilities(repository),
    ]);
    setAssets(loadedAssets);
    setLiabilities(loadedLiabilities);
    return loadedAssets.length + loadedLiabilities.length;
  }, [repository]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const count = await load();
      if (cancelled) return;
      if (count === 0 && seed) {
        // Written through the repository rather than held in component state,
        // so the preview genuinely exercises encrypt-on-write.
        for (const asset of seed.assets) await saveAsset(repository, asset, clock());
        for (const liability of seed.liabilities) {
          await saveLiability(repository, liability, clock());
        }
        if (!cancelled) await load();
      }
      if (!cancelled) setStatus('ready');
    })().catch(() => {
      // A read that fails is not an empty portfolio. Showing "nothing tracked
      // yet" over an unreadable store invites the user to enter it all again.
      if (!cancelled) setStatus('failed');
    });
    return () => {
      cancelled = true;
    };
  }, [load, repository, seed]);

  const addAsset = useCallback(() => {
    void (async () => {
      try {
        await saveAsset(
          repository,
          { name: 'New asset', category: 'other', value: 0, includeInNetWorth: true },
          clock(),
        );
        await load();
      } catch {
        setStatus('failed');
      }
    })();
  }, [repository, load, clock]);

  if (status === 'loading') return <Loading label="Loading your net worth" />;
  if (status === 'failed') {
    return (
      <Screen title="Net worth">
        <AppText tone="down">
          Your records could not be read on this device. They are encrypted with a key this
          app holds; nothing has been changed or lost.
        </AppText>
      </Screen>
    );
  }

  return (
    <DashboardScreen
      assets={assets}
      liabilities={liabilities}
      previousNetWorth={previousNetWorth}
      onAddAsset={addAsset}
    />
  );
}
