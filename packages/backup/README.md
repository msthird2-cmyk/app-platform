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
| `BackupTransport`, `BackupFile`, `BackupSummary` | Where a backup goes and comes from |
| `MAX_BACKUP_BYTES` | The import ceiling, enforced before a file is read |
| `runBackup`, `runRestore` | Collect → encrypt → hand to the user, and its inverse |
| `isBackupDue`, `nextBackupAt`, `describeStaleness` | When to remind somebody an export is due |
| `BackupSettings`, `BackupProgress`, `DEFAULT_BACKUP_SETTINGS` | Settings and progress model |
| `createFileBackupTransport` | Share sheet on a device, from injected Expo modules |
| `createWebBackupTransport`, `createDomBackupHost` | Download and file input, in a browser |
| `BackupStatus`, `BackupScreen` | Screens |
| `BackupError`, `BackupErrorCode` | Typed failures |

## Configuration

Applications supply the collection list, the passphrase and the backup interval.

## Dependencies

`@platform/ui`, `@platform/theme`, `@platform/utils`, `@platform/data`, `@platform/security`.

## Limitations

**Nothing is uploaded.** A backup is an encrypted file handed to the person, and this application keeps no copy — so a file they do not save is a backup they do not have, and a forgotten passphrase makes it unreadable by anybody, permanently. Restore overwrites local records and requires explicit confirmation.

This is not the device-loss recovery path. Recovery-code escrow is a separate mechanism in `@platform/security`, it restores a data key rather than records, and it is unaffected by any of this.

`runBackup` rejects a weak passphrase before reading any data — PBKDF2 raises the cost per guess but cannot rescue a guessable secret, and since the file leaves the application the passphrase is the only thing protecting it. Filenames carry a CSPRNG suffix so two exports in the same millisecond cannot collide.

An import is untrusted whatever picker produced it: anything over `MAX_BACKUP_BYTES` is refused **before the file is read or parsed**, which is where `storage.rules` used to stop it.

`runRestore` requires the owner, the application name and the collection allowlist. A bundle belonging to another account or another application fails the integrity check rather than decrypting, and a bundle naming a collection the application does not own is refused before any write.

## Tests

```
pnpm --filter @platform/backup test
```
