#!/usr/bin/env bash
#
# Installs the X-1 self-test APK on the running emulator, launches it, and reads
# the result out of logcat.
#
# Runs inside `reactivecircus/android-emulator-runner`, which has already booted
# the emulator and put `adb` on PATH.
#
# The exit status of this script is the verdict. Every path out of it either
# fails loudly or prints a result line, because the failure mode that matters is
# a run that produced nothing and was mistaken for a pass.

set -euo pipefail

PACKAGE="com.appplatform.x1selftest"
ACTIVITY=".MainActivity"
LOG="x1-selftest.log"
FULL_LOG="x1-selftest-full-logcat.log"
TIMEOUT_SECONDS=600

fail() {
  echo "::error::$*"
  exit 1
}

# The Gradle build tree is deleted before this runs, to leave the emulator room
# for its userdata partition, so the APK is read from where the build step
# copied it. The find is a fallback for running this script by hand.
APK="${X1_APK:-}"
if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  APK=$(find tools/x1-selftest/android/app/build/outputs/apk/release -name '*.apk' 2>/dev/null | head -1)
fi
[ -n "$APK" ] && [ -f "$APK" ] || fail "no release APK found — the Gradle build did not produce one"
echo "Installing $APK"

adb wait-for-device
adb shell settings put global window_animation_scale 0 || true
adb install -r -d "$APK" || fail "adb install failed"

echo "--- device ---"
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk
adb shell getprop ro.product.cpu.abi

adb logcat -c
adb shell am force-stop "$PACKAGE" || true
adb shell am start -n "${PACKAGE}/${ACTIVITY}" || fail "could not start the activity"

echo "--- waiting for the self-test to finish (timeout ${TIMEOUT_SECONDS}s) ---"
deadline=$((SECONDS + TIMEOUT_SECONDS))
finished=0
while [ $SECONDS -lt $deadline ]; do
  adb logcat -d > "$FULL_LOG" 2>/dev/null || true
  if grep -q 'X1-SELFTEST-END' "$FULL_LOG"; then
    finished=1
    break
  fi
  # A crash before the sentinel would otherwise burn the whole timeout.
  if grep -qE "FATAL EXCEPTION|Process ${PACKAGE} .*has died|beginning of crash" "$FULL_LOG"; then
    echo "--- crash detected ---"
    grep -E "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS" "$FULL_LOG" | tail -40 || true
    fail "the app crashed before completing the self-test"
  fi
  sleep 3
done

adb logcat -d > "$FULL_LOG" 2>/dev/null || true
[ "$finished" -eq 1 ] || {
  echo "--- last 60 log lines ---"
  tail -60 "$FULL_LOG" || true
  fail "timed out after ${TIMEOUT_SECONDS}s without an X1-SELFTEST-END sentinel"
}

# Keep only what the harness printed, in order.
grep -E 'X1-SELFTEST-(BEGIN|RESULT|END)|X1\|' "$FULL_LOG" \
  | sed 's/.*\(X1-SELFTEST-[A-Z]*\)/\1/; s/.*\(X1|\)/\1/' \
  | awk '!seen[$0]++' > "$LOG"

echo "==================== X-1 SELF-TEST OUTPUT ===================="
cat "$LOG"
echo "=============================================================="

grep -q 'X1-SELFTEST-BEGIN' "$LOG" || fail "the self-test never started"

# Surfaced as its own line so the number is greppable in the job log and in the
# workflow summary rather than buried in the transcript.
if PB=$(grep -m1 'PBKDF2_MS' "$LOG"); then
  MS=$(echo "$PB" | awk '{print $NF}')
  IT=$(grep -m1 'PBKDF2_ITERATIONS' "$LOG" | awk '{print $NF}')
  echo "PBKDF2: ${MS} ms at ${IT} iterations on this device"
  {
    echo "### X-1 Android runtime"
    echo ""
    echo "- PBKDF2: **${MS} ms** at **${IT}** iterations"
    grep -m1 'ENGINE' "$LOG" | sed 's/^X1| /- Engine: /' || true
    grep -m1 'ENCRYPT_MS' "$LOG" | sed 's/^X1| ENCRYPT_MS /- Encrypt (incl. PBKDF2): /;s/$/ ms/' || true
    echo ""
    echo '```'
    cat "$LOG"
    echo '```'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
else
  fail "no PBKDF2 timing was reported — the self-test did not reach the measurement"
fi

if grep -q '^X1| FAIL' "$LOG"; then
  echo "--- failing checks ---"
  grep '^X1| FAIL' "$LOG"
  fail "one or more X-1 runtime checks failed on Hermes"
fi

grep -q 'X1-SELFTEST-RESULT PASS' "$LOG" \
  || fail "the self-test did not report PASS"

echo "X-1 runtime checks passed on Hermes."
