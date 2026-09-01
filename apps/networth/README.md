# Net Worth

Net worth calculation, asset categories, liabilities and the dashboard.

## Backends

This application is the platform's production composition root. Which backend a
build talks to is decided in `index.tsx` from configuration alone, and nothing
else in the application knows or can find out.

| `EXPO_PUBLIC_NETWORTH_BACKEND` | Result |
| --- | --- |
| unset, or `preview` | In-memory services. Nothing leaves the process. |
| `firebase` | Firebase services, provided every value below is set. |
| `firebase`, a value missing | **Misconfiguration screen.** No fallback. |
| anything else | **Misconfiguration screen.** A typo is not consent. |

A build that asked for Firebase and cannot have it does not become a preview
build. It would look like a working application while every record went into a
process about to exit, which is the same class of failure as a plaintext
fallback.

## Configuration

Set these in the environment before building. `babel-preset-expo` inlines
`EXPO_PUBLIC_*` at build time, so no dependency and no committed file is
involved — and `.env` is git-ignored.

```
EXPO_PUBLIC_NETWORTH_BACKEND=firebase
EXPO_PUBLIC_FIREBASE_API_KEY=…
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=…
EXPO_PUBLIC_FIREBASE_PROJECT_ID=…
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=…
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=…
EXPO_PUBLIC_FIREBASE_APP_ID=…
```

None of these is a secret — Firebase client configuration ships in every bundle
by design, which is exactly why the Security Rules are the authorization
boundary and not these values. They are still deployment configuration, and a
project id committed to a repository is a project somebody eventually writes to
by accident.

**No configuration is checked in, and no default project exists.** A checkout
with none of these set is a preview build.

## What has and has not been verified

**A live Firestore round trip has been performed.** `tests/firebase.integration.test.ts`
runs this application's own production composition against a real Firebase
project: sign-in with a verified address, a record written through
`useRepository()`'s repository and read back, the stored document inspected over
REST and confirmed to hold ciphertext and no name, category or amount, an update,
a tombstone, the recovery escrow saved and reopened, and the full two-device
pairing exchange over the real relay.

Run it by setting the six `EXPO_PUBLIC_FIREBASE_*` values plus
`NETWORTH_TEST_EMAIL` and `NETWORTH_TEST_PASSWORD`; with any of them missing the
suite skips and the rest of the tests run normally. Point it only at a
disposable project — it writes and deletes documents under the signed-in user.
The account needs a verified address, because the rules require one on every
record write and nothing here can grant it.

One gap remains. Key custody cannot be exercised off-device at all: the
architecture refuses a `memory` protection tier, so the data key in that suite
is held by the harness rather than a keystore, and custody itself is proven on
Android API 29 and 34 by the Hermes self-test.

## What a production build does and does not have

- **Records** are encrypted on the device before they reach Firestore, under a
  key Firebase never sees. `useRepository()` cannot hand a screen anything but
  the encryption boundary.
- **Recovery** is the Gate 3 escrow at `users/{uid}/recoveryEscrow/current`.
  It restores the data key after every trusted device is lost. It is not a
  backup, and a backup is not recovery.
- **Backup** is an encrypted file you export and keep. Nothing is uploaded, no
  copy is retained here, and no one — including whoever runs this — can open it
  or reset its passphrase. Save it somewhere you control, or you do not have one.
- **A passphrase on this device's key** is offered and off by default. It wraps
  the data key in the keystore, so the keystore alone stops being enough to read
  your records: a device found at rest needs the passphrase too, asked for once
  each cold start. It is never sent anywhere, and there is nothing that can
  reset it. Forgetting it costs this device and not your data — your recovery
  code still works on a fresh install. It does not protect a device somebody
  takes while the app is open and unlocked.
- **Pairing** is available, because a Firebase build supplies the relay.
- **App Check is disabled**, with a stated reason: on React Native attestation
  comes from the native Firebase SDK, and the web SDK's reCAPTCHA providers do
  not apply. Wiring the native side is separate work and is not done.
- **Writing records requires a verified email address** — `firestore.rules`
  checks `email_verified` on every record create and update.
