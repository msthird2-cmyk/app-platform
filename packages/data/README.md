# @platform/data

The persistence boundary: repository interface, sync with conflict resolution, record validation, and encrypted import/export.

## Installation

Workspace package — depend on it from an application or a package that is allowed to:

```json
{ "dependencies": { "@platform/data": "workspace:*" } }
```

Import from the package root only:

```ts
import { /* … */ } from '@platform/data';
```

Deep paths such as `@platform/data/src/...` are rejected by ESLint, so internal files can change without it being a breaking change.

## Usage

```ts
import { runSync, InMemoryRepository, createRecord } from '@platform/data';

const local = new InMemoryRepository();
await local.put('assets', createRecord('a1', { name: 'Savings', value: 200000 }, Date.now()));
await runSync('assets', local, remoteRepository);
```

## Public API

| Export | What it does |
| --- | --- |
| `Repository`, `SyncableRecord`, `QueryOptions` | The persistence contract |
| `InMemoryRepository` | Reference implementation for tests and previews |
| `resolveConflict`, `touch` | Last-write-wins on the server timestamp, revision breaks ties, tombstones win |
| `planSync`, `runSync` | Two-way sync between any two repositories |
| `createRecord`, `isSyncableRecord`, `assertSyncableRecord` | Record validation |
| `buildExportBundle`, `encryptExportBundle`, `decryptExportBundle`, `parseExportBundle` | Versioned, encrypted export format |
| `DataError`, `DataErrorCode` | Typed failures |

## Configuration

Applications supply the collection names and inject the concrete `Repository`.

## Dependencies

`@platform/utils`, `@platform/security`.

## Limitations

Deletes are soft: a tombstone must sync before it can be dropped. Export bundles are versioned — a bundle from a newer schema is rejected rather than partially read.

Conflict resolution compares `updatedAt` **before** `revision`, deliberately: the remote adapter writes `updatedAt` with the server's clock and a client cannot forge it, whereas `revision` is authored on the device. Comparing the revision first would let one device claim an arbitrarily high number and win every subsequent conflict.

`parseExportBundle` validates the envelope and each record's sync metadata, rejects the reserved keys `__proto__`, `constructor` and `prototype`, and builds its result on a null prototype. It does **not** validate application fields — a caller restoring a bundle must still constrain which collections may be written.

## Tests

```
pnpm --filter @platform/data test
```
