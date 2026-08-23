# @platform/ui

Generic React Native components built on the shared theme. No business logic, no app-specific copy.

## Installation

Workspace package — depend on it from an application or a package that is allowed to:

```json
{ "dependencies": { "@platform/ui": "workspace:*" } }
```

Import from the package root only:

```ts
import { /* … */ } from '@platform/ui';
```

Deep paths such as `@platform/ui/src/...` are rejected by ESLint, so internal files can change without it being a breaking change.

## Usage

```tsx
import { Screen, ListRow, Button } from '@platform/ui';

<Screen title="Assets">
  <ListRow title="Savings" meta="Cash" value="₹2,00,000" />
  <Button label="Add asset" onPress={openSheet} />
</Screen>;
```

## Public API

| Component | Notes |
| --- | --- |
| `AppText` | Type steps and tones; `numeric` switches on tabular figures |
| `Button` | `primary` / `secondary` / `danger` / `ghost`, 48px minimum height |
| `Card`, `Screen`, `EmptyState`, `Loading` | Layout primitives |
| `TextField` | Labelled input with an error slot |
| `ListRow` | Stacked record row — name and value first, metadata second |
| `ConfirmDialog` | Bottom-sheet confirmation, optionally gated on a typed phrase |
| `ProgressBar` | Clamped 0–1 progress with an accessibility value |

## Configuration

Components take copy as props — they never contain user-facing strings of their own.

## Dependencies

`@platform/theme`, `@platform/utils`.

## Limitations

Presentation only. Anything that decides *what* to show belongs in an application or a domain package.

## Tests

```
pnpm --filter @platform/ui test
```
