/**
 * Excludes `expo` from React Native's generated `PackageList.java`.
 *
 * Two things are true at once, and together they break the Android release
 * build:
 *
 * 1. Expo already registers its own modules. The generated `MainApplication.kt`
 *    wraps the host in `expo.modules.ReactNativeHostWrapper`, so adding
 *    `ExpoModulesPackage` to `PackageList` is redundant.
 * 2. The entry autolinking generates is wrong. It infers the import from
 *    `expo/android/build.gradle`, which declares `namespace "expo.core"` — a
 *    legacy value. The class actually shipped in expo 52 is
 *    `expo.modules.ExpoModulesPackage`, and there is no `expo.core` package at
 *    all, so `:app:compileReleaseJavaWithJavac` fails with
 *    "cannot find symbol: class ExpoModulesPackage".
 *
 * Setting the android platform to null for `expo` leaves it out of
 * `PackageList` while changing nothing about how the modules are loaded — the
 * wrapper still does that.
 */
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: null,
      },
    },
  },
};
