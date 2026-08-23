# @platform/backup

Manual and automatic backup, restore, scheduling, status and progress reporting.

## Installation

Workspace package — depend on it from an application or a package that is allowed to:

```json
{ "dependencies": { "@platform/backup": "workspace:*" } }
```

Import from the package root only:

```ts
import { /* … */ } from '@platform/backup';
```

Deep paths such as `@platform/backup/src/...` are rejected by ESLint, so internal files can change without it being a breaking change.

## Usage

```ts
import { runBackup, isBackupDue } from '@platform/backup';

if (isBackupDue(settings, Date.now())) {
  await runBackup(repository, cryptoService, backupService, {
    appName: 'Net Worth',
    collections: ['assets', 'liabilities'],
    passphrase,
    now: Date.now(),
    onProgress: setProgress,
  });
}
```

## Public API

| Export | What it does |
| --- | --- |
| `BackupService`, `BackupSummary` | The backup storage contract |
| `runBackup`, `runRestore` | Collect → encrypt → upload, and its inverse |
| `isBackupDue`, `nextBackupAt`, `describeStaleness` | Automatic backup scheduling |
| `BackupSettings`, `BackupProgress`, `DEFAULT_BACKUP_SETTINGS` | Settings and progress model |
| `InMemoryBackupService` | A working BackupService with no backend, for previews and tests |
| `BackupStatus`, `BackupScreen` | Screens |
| `BackupError`, `BackupErrorCode` | Typed failures |

## Configuration

Applications supply the collection list, the passphrase and the backup interval.

## Dependencies

`@platform/ui`, `@platform/theme`, `@platform/utils`, `@platform/data`, `@platform/security`.

## Limitations

Only the encrypted payload leaves the device; the passphrase is never uploaded, so a lost passphrase means an unreadable backup. Restore overwrites local records and requires explicit confirmation.

## Tests

```
pnpm --filter @platform/backup test
```
