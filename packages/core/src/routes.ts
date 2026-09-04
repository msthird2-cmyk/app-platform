import type { ComponentType } from 'react';
import type { SettingsSection } from '@platform/account';

/**
 * The shell's route table: what destinations exist, and which of them a person
 * can reach.
 *
 * Pure, and separate from anything that renders, for the reason `dataKeyStep`
 * gives: this package has no component-test infrastructure, so a decision left
 * inside a component can only be checked by reading it. Which routes exist, and
 * which settings rows the composition has actually earned, are decisions with
 * consequences — a row offering a capability nothing wired is a button that
 * cannot finish what it starts.
 *
 * An application declares its own destinations and nothing else. The shell owns
 * the table: it appends `Settings`, it owns that tab's stack, and an app can
 * neither add to it nor reorder it. One direction of extension, so there is one
 * place to audit.
 */

/** The shell's own tab. An application may not declare it or push into it. */
export const SETTINGS_TAB = 'settings';

/** The platform's own destinations inside the Settings stack. */
export const SETTINGS_PROFILE = 'settings/profile';
export const SETTINGS_BACKUP = 'settings/backup';
export const SETTINGS_DELETE = 'settings/delete';

export interface AppDestination {
  /** Stable, unique within the table. The navigator's route name. */
  readonly name: string;
  /** Tab label and stack header title. */
  readonly title: string;
  /** Lucide icon name, resolved by the shell. Absent renders a text label. */
  readonly icon?: string;
  readonly component: ComponentType;
}

/** A destination reachable only by pushing onto a tab's stack. */
export interface AppDetailDestination extends AppDestination {
  /** Which tab's stack it belongs to. Must name a member of `tabs`. */
  readonly within: string;
}

export interface AppRouteTable {
  /** At least one. The order is the tab order; `Settings` is appended by the
   *  shell and may not appear here. */
  readonly tabs: readonly [AppDestination, ...AppDestination[]];
  /** The tab the app opens on, and the tab hardware back returns to. Must name
   *  a member of `tabs`; defaults to the first. Explicit rather than positional
   *  so that reordering the tabs does not silently move home. */
  readonly home?: string;
  readonly details?: readonly AppDetailDestination[];
  readonly modals?: readonly AppDestination[];
  /** Extra rows for the Settings tab, below the platform's own. */
  readonly settingsSections?: readonly SettingsSection[];
}

/** What the composition actually wired. A row is offered only where its
 *  capability exists, the discipline `pairingRelay` and `backupTransport`
 *  already follow: a capability that cannot be completed is not offered. */
export interface ShellCapabilities {
  readonly backupAvailable: boolean;
  readonly pairingAvailable: boolean;
  readonly signOutAvailable: boolean;
  readonly deleteAccountAvailable: boolean;
}

export interface ResolvedRouteTable {
  /** App tabs, in declaration order, then `Settings`. */
  readonly tabs: readonly AppDestination[];
  /** App details, then the platform's own settings destinations. */
  readonly details: readonly AppDetailDestination[];
  readonly modals: readonly AppDestination[];
  readonly settingsRows: readonly SettingsRowId[];
  /** Always an app tab, never `Settings`. */
  readonly home: string;
}

export type SettingsRowId =
  | 'profile' | 'theme' | 'passphrase' | 'pair-device'
  | 'backup' | 'sign-out' | 'delete-account';

/**
 * Stands in for a screen this gate cannot name.
 *
 * The platform's own destinations need a `component`, and theirs are
 * `SettingsRoute` and the account and backup screens — none of which exist yet,
 * and none of which this module may import: pulling a screen in makes every
 * test of this file load `react-native`, whose Flow source the test runner
 * cannot parse. That is measured, not assumed.
 *
 * So the names and the gating are decided here, where they are testable, and
 * the binding from name to screen is the shell's when it is built. **Nothing
 * renders this**: no navigator exists to render it with. See the gate report —
 * this is the one place where the accepted signature and the gate order pull
 * apart, and it is recorded rather than papered over.
 */
const SCREEN_BOUND_BY_THE_SHELL: ComponentType = () => null;

const platformSettingsRoutes = (): AppDetailDestination[] => [
  { name: SETTINGS_PROFILE, title: 'Profile', within: SETTINGS_TAB, component: SCREEN_BOUND_BY_THE_SHELL },
  { name: SETTINGS_BACKUP, title: 'Backup', within: SETTINGS_TAB, component: SCREEN_BOUND_BY_THE_SHELL },
  // Present whether or not a deletion flow was injected. The ruling is that the
  // *row* is hidden, not the route: a route that vanished with its row would
  // make `DeleteAccount` unreachable, which FR-03 forbids.
  { name: SETTINGS_DELETE, title: 'Delete account', within: SETTINGS_TAB, component: SCREEN_BOUND_BY_THE_SHELL },
];

const invalid = (): never => {
  // One code for every shape problem. The table is written by a developer and
  // read at startup, so the distinction a caller could act on is "this table is
  // wrong", not which rule it broke; the thrown stack names the file.
  throw new Error('SHELL_ROUTE_TABLE_INVALID');
};

export function resolveRouteTable(
  table: AppRouteTable,
  capabilities: ShellCapabilities,
): ResolvedRouteTable {
  const tabs = table.tabs ?? [];
  if (tabs.length === 0) invalid();

  const details = table.details ?? [];
  const modals = table.modals ?? [];

  const declared = [...tabs, ...details, ...modals];
  const seen = new Set<string>();
  for (const destination of declared) {
    const { name } = destination;
    if (typeof name !== 'string' || name.length === 0) invalid();
    // Reserved before duplicates are considered, so an app declaring `settings`
    // gets the reason it is refused rather than a collision with the tab the
    // shell is about to append.
    if (name === SETTINGS_TAB || name.startsWith(`${SETTINGS_TAB}/`)) invalid();
    if (seen.has(name)) invalid();
    seen.add(name);
  }

  const tabNames = new Set(tabs.map((destination) => destination.name));
  for (const detail of details) {
    // `within` may not name the Settings tab: that stack is the shell's, and an
    // app pushing into it would be adding a route to a destination it does not
    // own.
    if (!tabNames.has(detail.within)) invalid();
  }

  const home = table.home ?? tabs[0].name;
  if (!tabNames.has(home)) invalid();

  return Object.freeze({
    tabs: Object.freeze([
      ...tabs,
      { name: SETTINGS_TAB, title: 'Settings', component: SCREEN_BOUND_BY_THE_SHELL },
    ]),
    details: Object.freeze([...details, ...platformSettingsRoutes()]),
    modals: Object.freeze([...modals]),
    settingsRows: Object.freeze(settingsRows(capabilities)),
    home,
  });
}

/**
 * The rows, in the order they are shown.
 *
 * `profile`, `theme` and `passphrase` depend on nothing a composition can fail
 * to wire, so they are unconditional. The other four each name exactly one
 * capability, and each is dropped on its own — never as a group, so a row gated
 * on the wrong flag is a visible difference rather than a coincidence.
 */
function settingsRows(capabilities: ShellCapabilities): SettingsRowId[] {
  const rows: SettingsRowId[] = ['profile', 'theme', 'passphrase'];
  if (capabilities.pairingAvailable) rows.push('pair-device');
  if (capabilities.backupAvailable) rows.push('backup');
  if (capabilities.signOutAvailable) rows.push('sign-out');
  if (capabilities.deleteAccountAvailable) rows.push('delete-account');
  return rows;
}
