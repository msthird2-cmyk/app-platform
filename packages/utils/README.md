# @platform/utils

Pure helpers shared by every package and application: dates, formatting, currency, validation, identifiers, typed errors and safe logging.

## Installation

Workspace package — depend on it from an application or a package that is allowed to:

```json
{ "dependencies": { "@platform/utils": "workspace:*" } }
```

Import from the package root only:

```ts
import { /* … */ } from '@platform/utils';
```

Deep paths such as `@platform/utils/src/...` are rejected by ESLint, so internal files can change without it being a breaking change.

## Usage

```ts
import { createLogger, formatCurrency, sumAmounts } from '@platform/utils';

const log = createLogger({ scope: 'networth' });
log.info('recalculated', { total: 125000 }); // total is redacted before it is written

formatCurrency(125000);        // '₹1,25,000'
sumAmounts([0.1, 0.2]);        // 0.3 — not 0.30000000000000004
```

## Public API

| Export | What it does |
| --- | --- |
| `createLogger`, `logger`, `redact` | Logging that redacts sensitive keys before anything is emitted |
| `CodedError`, `isCodedError`, `errorCode` | Typed, coded errors and structural narrowing |
| `Result`, `ok`, `err`, `unwrapOr` | Explicit success/failure without exceptions |
| `formatCurrency`, `parseAmount`, `toMinorUnits`, `sumAmounts` | Money formatting and float-safe arithmetic |
| `toIsoDate`, `addMonths`, `monthsBetween`, `monthKey`, … | UTC date arithmetic |
| `formatNumber`, `formatPercent`, `truncate`, `titleCase` | Display formatting |
| `validate`, `validateAll`, `required`, `email`, `inRange` | Composable validators returning error codes |
| `createId` | URL-safe non-secret identifier |

## Configuration

None. This package must stay free of configuration so everything else can depend on it.

## Dependencies

Nothing internal.

## Limitations

`createId` is not cryptographically secret — use `@platform/security` for anything that must be unguessable. Date helpers work in UTC; render with a locale at the edge.

## Tests

```
pnpm --filter @platform/utils test
```
