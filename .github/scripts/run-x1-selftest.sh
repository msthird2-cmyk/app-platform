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
# A hang detector, not a budget. PBKDF2 at the shipped cost takes roughly
# twenty-five seconds per pass on this hardware and the suite runs a couple of
# dozen derivations, so a healthy run sits in the four-to-seven minute range and
# varies with how contended the runner is. At 600 the margin was thin enough
# that one slower-than-usual API 34 emulator tripped it while API 29 passed on
# the same commit. Raising it does not make any check easier to satisfy — every
# assertion and the KDF cost are unchanged, and a genuine hang still fails the
# job, just later. The step itself is bounded by the job's 60-minute limit.
TIMEOUT_SECONDS=900

fail() {
  echo "::error::$*"
  exit 1
}

# Crash evidence, with every alternative scoped to the package under test.
#
# The previous pattern included `beginning of crash`, which is the separator
# `adb logcat -d` prints whenever the crash buffer holds anything at all — from
# any process on the device. A cold-booted emulator repopulates that buffer
# from its own system components within seconds of `logcat -c`, so a perfectly
# healthy run could be failed by somebody else's crash, and was. Bare
# `FATAL EXCEPTION` had the same defect more quietly: it names no process.
#
# These three are the three ways this package can die, and each carries the
# package name on the same line as the evidence:
#
#   AndroidRuntime: Process: <pkg>   the JVM crash header, printed as part of
#                                    every FATAL EXCEPTION block
#   >>> <pkg> <<<                    the native tombstone header from `DEBUG`
#   Process <pkg> ... has died       ActivityManager reporting process death
#
# Nothing another process writes matches any of them, and no way this package
# can crash is missing from them — a Java crash also produces the third, so the
# coverage overlaps rather than relying on one line surviving.
CRASH_PATTERN="AndroidRuntime: Process: ${PACKAGE}|>>> ${PACKAGE} <<<|Process ${PACKAGE} .*has died"

# `--self-check` runs the detector against fixtures and exits. No device, no
# adb: it exists so the pattern is covered by the unit suite, and so the case
# that actually went wrong stays covered by name.
if [ "${1:-}" = "--self-check" ]; then
  fixture=$(mktemp)
  trap 'rm -f "$fixture"' EXIT
  status=0

  # expect <yes|no> <name>, fixture on stdin.
  expect() {
    local want="$1" name="$2" got
    cat > "$fixture"
    if grep -qE "$CRASH_PATTERN" "$fixture"; then got=yes; else got=no; fi
    if [ "$got" = "$want" ]; then
      echo "self-check ok   [$name] detected=$got"
    else
      echo "self-check FAIL [$name] detected=$got wanted=$want"
      status=1
    fi
  }

  # The regression. Every line here is another process crashing, including the
  # buffer separator and a FATAL EXCEPTION, while this app is running normally.
  expect no 'unrelated process crash' <<'FIXTURE'
--------- beginning of crash
E AndroidRuntime: FATAL EXCEPTION: main
E AndroidRuntime: Process: com.google.android.gms, PID: 1234
I ActivityManager: Process com.google.android.gms (pid 1234) has died: cch CEM
F DEBUG   : pid: 1234, tid: 1234, name: gms  >>> com.google.android.gms <<<
I ReactNativeJS: X1| PASS the encryption boundary marker survives Babel and Hermes
FIXTURE

  expect yes 'target app java crash' <<FIXTURE
--------- beginning of crash
E AndroidRuntime: FATAL EXCEPTION: main
E AndroidRuntime: Process: ${PACKAGE}, PID: 5461
E AndroidRuntime: java.lang.RuntimeException: could not start the harness
FIXTURE

  expect yes 'target app native crash' <<FIXTURE
F DEBUG   : pid: 5461, tid: 5461, name: pplatform.x1self  >>> ${PACKAGE} <<<
F DEBUG   : signal 11 (SIGSEGV), code 1 (SEGV_MAPERR)
FIXTURE

  expect yes 'target app process death' <<FIXTURE
I ActivityManager: Process ${PACKAGE} (pid 5461) has died: fg TOP
FIXTURE

  [ "$status" -eq 0 ] || echo "::error::the crash detector self-check failed"
  exit "$status"
fi

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

adb shell am force-stop "$PACKAGE" || true
# Cleared after the force-stop, not before it: ActivityManager reports the
# teardown as a process death, and that is indistinguishable from the real
# thing once it is sitting in the buffer the first poll reads back.
adb logcat -c
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
  if grep -qE "$CRASH_PATTERN" "$FULL_LOG"; then
    echo "--- crash detected ---"
    # The evidence that fired, first. The old diagnostic could match nothing at
    # all, which is how a failure once arrived with no stated reason.
    grep -nE "$CRASH_PATTERN" "$FULL_LOG" | tail -10
    echo "--- context ---"
    grep -E "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|DEBUG" "$FULL_LOG" | tail -40 || true
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
