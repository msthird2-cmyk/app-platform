import { describe, expect, it } from 'vitest';
import {
  SETTINGS_TAB,
  resolveRouteTable,
  type AppDestination,
  type AppRouteTable,
  type ShellCapabilities,
} from '../src/routes';

/**
 * The shell's route table, decided as data.
 *
 * Nothing here renders. The `dataKeyStep` argument applies unchanged: the part
 * with consequences is which destinations exist and which of them a person can
 * reach, and that is a pure function of the app's declaration and what the
 * composition actually wired.
 */

const screen = (): null => null;
const tab = (name: string, title = name): AppDestination => ({ name, title, component: screen });

const APP: AppRouteTable = { tabs: [tab('assets', 'Assets'), tab('trends', 'Trends')] };

/** Everything wired. Each test narrows exactly one flag from this. */
const ALL: ShellCapabilities = {
  backupAvailable: true,
  pairingAvailable: true,
  signOutAvailable: true,
  deleteAccountAvailable: true,
};

const names = (destinations: readonly { name: string }[]): string[] =>
  destinations.map((destination) => destination.name);

describe('resolveRouteTable — the shell owns the table', () => {
  it('appends Settings, after the app tabs, in every case', () => {
    expect(names(resolveRouteTable(APP, ALL).tabs)).toEqual(['assets', 'trends', SETTINGS_TAB]);
    const none: ShellCapabilities = {
      backupAvailable: false,
      pairingAvailable: false,
      signOutAvailable: false,
      deleteAccountAvailable: false,
    };
    // "In every case" includes the case where every optional capability is
    // absent: Settings still carries theme and profile, so the tab is not
    // conditional on anything.
    expect(names(resolveRouteTable(APP, none).tabs)).toEqual(['assets', 'trends', SETTINGS_TAB]);
  });

  it('passes the app tabs through in declaration order', () => {
    const table: AppRouteTable = { tabs: [tab('c'), tab('a'), tab('b')] };
    expect(names(resolveRouteTable(table, ALL).tabs)).toEqual(['c', 'a', 'b', SETTINGS_TAB]);
  });

  it('defaults home to the first tab', () => {
    expect(resolveRouteTable(APP, ALL).home).toBe('assets');
  });

  it('honours a declared home that is not the first tab', () => {
    expect(resolveRouteTable({ ...APP, home: 'trends' }, ALL).home).toBe('trends');
  });

  it('never resolves home to Settings', () => {
    // Settings is the shell's, and opening there would mean an app whose first
    // screen is the platform's rather than its own.
    expect(resolveRouteTable(APP, ALL).home).not.toBe(SETTINGS_TAB);
  });
});

describe('resolveRouteTable — what it refuses', () => {
  it('refuses an app declaring Settings', () => {
    const table = { tabs: [tab('assets'), tab(SETTINGS_TAB)] } as unknown as AppRouteTable;
    expect(() => resolveRouteTable(table, ALL)).toThrow('SHELL_ROUTE_TABLE_INVALID');
  });

  it('refuses a duplicate name across tabs', () => {
    const table = { tabs: [tab('assets'), tab('assets')] } as unknown as AppRouteTable;
    expect(() => resolveRouteTable(table, ALL)).toThrow('SHELL_ROUTE_TABLE_INVALID');
  });

  it('refuses a name duplicated between a tab and a detail', () => {
    const table = {
      tabs: [tab('assets')],
      details: [{ ...tab('assets'), within: 'assets' }],
    } as unknown as AppRouteTable;
    expect(() => resolveRouteTable(table, ALL)).toThrow('SHELL_ROUTE_TABLE_INVALID');
  });

  it('refuses a name duplicated between a detail and a modal', () => {
    const table = {
      tabs: [tab('assets')],
      details: [{ ...tab('detail'), within: 'assets' }],
      modals: [tab('detail')],
    } as unknown as AppRouteTable;
    expect(() => resolveRouteTable(table, ALL)).toThrow('SHELL_ROUTE_TABLE_INVALID');
  });

  it('refuses an empty tab list', () => {
    const table = { tabs: [] } as unknown as AppRouteTable;
    expect(() => resolveRouteTable(table, ALL)).toThrow('SHELL_ROUTE_TABLE_INVALID');
  });

  it('refuses a dangling `within`', () => {
    const table = {
      tabs: [tab('assets')],
      details: [{ ...tab('asset-detail'), within: 'nowhere' }],
    } as unknown as AppRouteTable;
    expect(() => resolveRouteTable(table, ALL)).toThrow('SHELL_ROUTE_TABLE_INVALID');
  });

  it('refuses a `within` naming the Settings tab', () => {
    // Settings is the shell's stack. An app pushing into it would be adding a
    // route to a destination it does not own.
    const table = {
      tabs: [tab('assets')],
      details: [{ ...tab('sneaky'), within: SETTINGS_TAB }],
    } as unknown as AppRouteTable;
    expect(() => resolveRouteTable(table, ALL)).toThrow('SHELL_ROUTE_TABLE_INVALID');
  });

  it('refuses a home naming no tab', () => {
    expect(() => resolveRouteTable({ ...APP, home: 'nowhere' }, ALL)).toThrow(
      'SHELL_ROUTE_TABLE_INVALID',
    );
  });

  it('refuses a home naming a detail rather than a tab', () => {
    const table = {
      tabs: [tab('assets')],
      details: [{ ...tab('asset-detail'), within: 'assets' }],
      home: 'asset-detail',
    } as unknown as AppRouteTable;
    expect(() => resolveRouteTable(table, ALL)).toThrow('SHELL_ROUTE_TABLE_INVALID');
  });

  it('refuses an empty route name', () => {
    const table = { tabs: [tab('')] } as unknown as AppRouteTable;
    expect(() => resolveRouteTable(table, ALL)).toThrow('SHELL_ROUTE_TABLE_INVALID');
  });
});

describe('resolveRouteTable — the four conditional rows', () => {
  /** `ALL` with exactly one capability withdrawn. */
  const without = (flag: keyof ShellCapabilities): ShellCapabilities => ({ ...ALL, [flag]: false });

  const CASES = [
    { row: 'backup', flag: 'backupAvailable' },
    { row: 'pair-device', flag: 'pairingAvailable' },
    { row: 'sign-out', flag: 'signOutAvailable' },
    { row: 'delete-account', flag: 'deleteAccountAvailable' },
  ] as const;

  for (const { row, flag } of CASES) {
    it(`includes the ${row} row when ${flag} is true`, () => {
      expect(resolveRouteTable(APP, ALL).settingsRows).toContain(row);
    });

    it(`omits the ${row} row when ${flag} is false`, () => {
      expect(resolveRouteTable(APP, without(flag)).settingsRows).not.toContain(row);
    });

    it(`withdrawing ${flag} drops no row but ${row}`, () => {
      // One capability at a time, so a row gated on the wrong flag fails here
      // rather than passing an all-on/all-off pair.
      const full = resolveRouteTable(APP, ALL).settingsRows;
      const reduced = resolveRouteTable(APP, without(flag)).settingsRows;
      expect(full.filter((id) => id !== row)).toEqual(reduced);
    });
  }

  it('always offers the rows that depend on nothing', () => {
    const none: ShellCapabilities = {
      backupAvailable: false,
      pairingAvailable: false,
      signOutAvailable: false,
      deleteAccountAvailable: false,
    };
    expect(resolveRouteTable(APP, none).settingsRows).toEqual(['profile', 'theme', 'passphrase']);
  });
});

describe('resolveRouteTable — a hidden row is not a missing route', () => {
  it('keeps settings/delete in details whichever way deleteAccountAvailable falls', () => {
    // The §Q2 ruling is that the row is hidden, not the route. A test that only
    // checked the row would pass if the route vanished with it.
    for (const deleteAccountAvailable of [true, false]) {
      const resolved = resolveRouteTable(APP, { ...ALL, deleteAccountAvailable });
      expect(names(resolved.details)).toContain('settings/delete');
    }
  });

  it('keeps every platform settings route present regardless of capability', () => {
    const none: ShellCapabilities = {
      backupAvailable: false,
      pairingAvailable: false,
      signOutAvailable: false,
      deleteAccountAvailable: false,
    };
    expect(names(resolveRouteTable(APP, none).details)).toEqual(
      expect.arrayContaining(['settings/profile', 'settings/backup', 'settings/delete']),
    );
  });

  it('puts every platform settings route inside the Settings tab', () => {
    const resolved = resolveRouteTable(APP, ALL);
    for (const detail of resolved.details.filter((d) => d.name.startsWith('settings/'))) {
      expect(detail.within).toBe(SETTINGS_TAB);
    }
  });

  it('carries the app details through alongside the platform ones', () => {
    const table: AppRouteTable = {
      tabs: [tab('assets')],
      details: [{ ...tab('asset-detail'), within: 'assets' }],
    };
    const resolved = resolveRouteTable(table, ALL);
    expect(names(resolved.details)).toContain('asset-detail');
    expect(names(resolved.details)).toContain('settings/delete');
  });

  it('carries the app modals through, and adds none of its own', () => {
    const table: AppRouteTable = { tabs: [tab('assets')], modals: [tab('add-asset')] };
    expect(names(resolveRouteTable(table, ALL).modals)).toEqual(['add-asset']);
    expect(resolveRouteTable(APP, ALL).modals).toEqual([]);
  });
});
