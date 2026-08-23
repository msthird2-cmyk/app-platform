# @platform/theme

Design tokens and the theme runtime: colours, spacing, radii, type steps, `ThemeProvider`, `useTheme` and the system/light/dark `ThemeSelector`.

## Installation

Workspace package — depend on it from an application or a package that is allowed to:

```json
{ "dependencies": { "@platform/theme": "workspace:*" } }
```

Import from the package root only:

```ts
import { /* … */ } from '@platform/theme';
```

Deep paths such as `@platform/theme/src/...` are rejected by ESLint, so internal files can change without it being a breaking change.

## Usage

```tsx
import { ThemeProvider, useTheme, spacing } from '@platform/theme';

<ThemeProvider initialPreference="system" onPreferenceChange={persist}>
  <App />
</ThemeProvider>;

const theme = useTheme();
const styles = StyleSheet.create({ card: { backgroundColor: theme.colors.surface, padding: spacing.md } });
```

## Public API

| Export | What it does |
| --- | --- |
| `spacing`, `radius`, `typography`, `palette` | The token set — the only source of colour and spacing |
| `buildTheme`, `Theme`, `Colors`, `ColorScheme` | Resolved theme object |
| `ThemeProvider`, `useTheme`, `useThemeContext` | Theme context, following the OS scheme by default |
| `resolveScheme`, `ThemePreference` | Pure preference → scheme resolution |
| `ThemeSelector` | System / Light / Dark control |

## Configuration

`initialPreference` (restored from the app's stored settings) and `onPreferenceChange` (to persist it). The package never persists anything itself.

## Dependencies

`@platform/utils`.

## Limitations

`resolveScheme` is pure and testable; `ThemeProvider` imports `react-native`, whose Flow-typed source a plain test runner cannot parse — test the pure module instead, or alias `react-native` to `react-native-web`.

## Tests

```
pnpm --filter @platform/theme test
```
