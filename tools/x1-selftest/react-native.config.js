/**
 * Corrects the import path React Native's autolinking generates for `expo`.
 *
 * `expo/android/build.gradle` declares `namespace "expo.core"`, a legacy value.
 * Autolinking infers `packageImportPath` from that namespace rather than from
 * expo's own `react-native.config.js`, so the generated `PackageList.java`
 * contains `import expo.core.ExpoModulesPackage;` — and expo 52 ships no
 * `expo.core` package at all, only `expo.modules.ExpoModulesPackage`. The
 * result is `:app:compileReleaseJavaWithJavac` failing with
 * "cannot find symbol: class ExpoModulesPackage".
 *
 * Only that one field is overridden. An earlier attempt set the whole android
 * platform to `null`, which did remove the bad import — and also removed the
 * `:expo` Gradle project from the app's compile classpath, so
 * `MainApplication.kt` and `MainActivity.kt` could no longer resolve
 * `expo.modules.ReactNativeHostWrapper`, `ReactActivityDelegateWrapper` or
 * `ApplicationLifecycleDispatcher`. The entry has to stay; only its import path
 * is wrong.
 */
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: 'import expo.modules.ExpoModulesPackage;',
        },
      },
    },
  },
};
