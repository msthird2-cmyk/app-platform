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

The production composition is constructed and every layer above it is tested:
the encryption boundary, the record envelope, the key lifecycle and the pairing
relay all run against a store standing exactly where `FirebaseRepository`
stands. **No live Firestore round trip has been performed**, because no project
configuration exists in this repository or in CI. The first run against a real
project is the first time the network path, the Security Rules and the
`email_verified` requirement are exercised together.

## What a production build does and does not have

- **Records** are encrypted on the device before they reach Firestore, under a
  key Firebase never sees. `useRepository()` cannot hand a screen anything but
  the encryption boundary.
- **Recovery** is the Gate 3 escrow at `users/{uid}/recoveryEscrow/current`.
- **Pairing** is available, because a Firebase build supplies the relay.
- **App Check is disabled**, with a stated reason: on React Native attestation
  comes from the native Firebase SDK, and the web SDK's reCAPTCHA providers do
  not apply. Wiring the native side is separate work and is not done.
- **Writing records requires a verified email address** — `firestore.rules`
  checks `email_verified` on every record create and update.
