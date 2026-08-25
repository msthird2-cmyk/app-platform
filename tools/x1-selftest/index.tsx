import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { runSelfTest } from './selfTest';

/**
 * Entry point for the X-1 runtime self-test.
 *
 * Deliberately does **not** import `@platform/security` at the top level: the
 * self-test removes the browser globals before importing it, so that module
 * evaluation itself is covered. A static import here would evaluate the whole
 * graph first and quietly weaken the check.
 *
 * The screen exists only so a human can see the result when running this by
 * hand. CI reads the same lines from logcat.
 */
const BEGIN = 'X1-SELFTEST-BEGIN';
const END = 'X1-SELFTEST-END';

function Root() {
  const [lines, setLines] = useState<string[]>(['running…']);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      console.log(BEGIN);
      let outcome: { passed: boolean; lines: string[] };
      try {
        outcome = await runSelfTest();
      } catch (error) {
        outcome = { passed: false, lines: [`X1| FAIL harness threw :: ${String(error)}`] };
      }
      for (const line of outcome.lines) {
        console.log(line);
      }
      console.log(`X1-SELFTEST-RESULT ${outcome.passed ? 'PASS' : 'FAIL'}`);
      console.log(END);
      if (!cancelled) setLines(outcome.lines);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={{ flex: 1, paddingTop: 48, paddingHorizontal: 12 }}>
      <ScrollView>
        {lines.map((line, index) => (
          <Text key={index} style={{ fontSize: 12 }}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

registerRootComponent(Root);
