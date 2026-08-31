/**
 * A stand-in for `react-native` under Node.
 *
 * `createProductionServices` imports the shared package barrels, and some of
 * those barrels also export screens, so `react-native` ends up on the import
 * graph of a suite that renders nothing. Its published entry point is
 * Flow-typed source (`import typeof …`), which Vite cannot parse, so the
 * integration suite could not even load.
 *
 * Aliased only for `apps/networth`'s own test run, and only ever reached by
 * module resolution — no code path in the integration suite touches a
 * component. Vite's SSR transform reads named imports as property lookups on
 * the namespace object, so an absent name is `undefined` rather than a throw,
 * which is the correct behaviour for something that must never be called.
 *
 * This stubs a rendering library. It stubs nothing on the security path: the
 * cipher, the envelope, the repository, the rules and the Firebase services
 * are all the real ones.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Modules call this at import time to build their style objects. */
export const StyleSheet = {
  create: <T,>(styles: T): T => styles,
  flatten: (style: unknown) => style,
  hairlineWidth: 1,
  absoluteFill: {},
};

export const Platform = { OS: 'android', select: (choices: any) => choices.android ?? choices.default };
export const Dimensions = { get: () => ({ width: 0, height: 0, scale: 1, fontScale: 1 }) };
export const Appearance = { getColorScheme: () => 'light', addChangeListener: () => ({ remove() {} }) };
export const PixelRatio = { get: () => 1, getFontScale: () => 1 };

/** Components. Present so a module-scope reference resolves; never rendered. */
const component = (() => null) as any;
export const View = component;
export const Text = component;
export const Pressable = component;
export const TextInput = component;
export const ScrollView = component;
export const FlatList = component;
export const ActivityIndicator = component;
export const Modal = component;
export const Switch = component;
export const Image = component;
export const SafeAreaView = component;
export const KeyboardAvoidingView = component;
export const TouchableOpacity = component;

export const Animated = { View: component, Text: component, Value: class {}, timing: () => ({ start() {} }) };
export const Keyboard = { dismiss() {} };
export const Linking = { openURL: async () => undefined };

export default {
  StyleSheet,
  Platform,
  Dimensions,
  Appearance,
  PixelRatio,
  View,
  Text,
  Pressable,
};
