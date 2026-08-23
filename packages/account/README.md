# @platform/account

Profile, settings, account deletion, data deletion and data export — one configurable component per capability, shared by every application.

## Installation

Workspace package — depend on it from an application or a package that is allowed to:

```json
{ "dependencies": { "@platform/account": "workspace:*" } }
```

Import from the package root only:

```ts
import { /* … */ } from '@platform/account';
```

Deep paths such as `@platform/account/src/...` are rejected by ESLint, so internal files can change without it being a breaking change.

## Usage

```tsx
import { DeleteAccount, deleteAccountFlow } from '@platform/account';

<DeleteAccount
  title="Delete Account"
  description="This action cannot be undone."
  requireConfirmation
  messageForCode={messageForCode}
  onDelete={() => deleteAccountFlow(accountService, callbacks, { confirmed: true })}
/>;
```

## Public API

| Export | What it does |
| --- | --- |
| `AccountService`, `UserProfile` | The account contract, one call per deletion step |
| `deleteAccountFlow` | Ordered deletion that never orphans encrypted data |
| `deleteUserDataFlow` | Deletes data and backups, keeps the account |
| `isDeletionOrderValid`, `DELETION_STEPS`, `DeletionStep` | The canonical order |
| `DeleteAccount`, `ProfileScreen`, `SettingsScreen` | Screens and the danger zone |
| `AccountError`, `AccountErrorCode` | Typed failures |

## Configuration

Every string is a prop. `requireConfirmation` and `confirmationPhrase` gate the destructive action.

## Dependencies

`@platform/ui`, `@platform/theme`, `@platform/utils`, `@platform/data`.

## Limitations

The deletion order is deliberate and covered by a regression test:

```
confirm → reauthenticate → user data → backups → secondary records → account → clear local state → signed out
```

Deleting the authentication account earlier would orphan encrypted data that can no longer be authenticated for removal. Re-authentication is injected as a callback so this package does not depend on `@platform/auth`.

## Tests

```
pnpm --filter @platform/account test
```
