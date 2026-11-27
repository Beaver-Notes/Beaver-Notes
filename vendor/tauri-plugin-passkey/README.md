# Tauri Plugin Passkey

WebAuthn / FIDO2 / passkey authentication for Tauri 2 apps on **macOS, iOS, Android, Windows, and Linux**.

The plugin talks to each platform's native passkey API (ASAuthorization on Apple platforms, Credential Manager on Android, Windows WebAuthn API, direct CTAP2 on Linux) and exposes one JS API that consumes standard WebAuthn JSON options — the same shapes your relying-party server library (e.g. `webauthn-rs`, `@simplewebauthn/server`) already produces.

## Platform support

| Capability                          | Linux | macOS 14+       | iOS 17.4+       | Android 9+      | Windows 10 1903+     |
| ----------------------------------- | ----- | --------------- | --------------- | --------------- | -------------------- |
| `register` / `authenticate`         | ✅    | ✅              | ✅              | ✅              | ✅                   |
| PRF / hmac-secret extension         | ✅    | ✅ (macOS 15+)  | ✅ (iOS 18+)    | ✅              | ❌ (see [PRF](#prf)) |
| Credential discovery (usernameless) | ✅    | ✅              | ✅              | ✅              | ❌                   |
| `cancel`                            | ✅    | ✅              | ✅              | ✅              | ❌ (no-op)           |
| `sendPin` / `selectKey` / events    | ✅    | n/a — native UI | n/a — native UI | n/a — native UI | n/a — native UI      |

On everything except Linux, the operating system shows its own passkey UI (Touch ID / Face ID / Windows Hello / Android sheet), so PIN entry, device selection, and progress events never reach your app. On Linux the plugin drives a CTAP2 authenticator directly and surfaces those interactions as [events](#events-linux-only).

## Install

```bash
cargo add tauri-plugin-passkey            # in src-tauri/
pnpm add tauri-plugin-passkey-api         # in your frontend
```

Register the plugin in `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_passkey::init())
    // ...
```

Grant the permission in `src-tauri/capabilities/default.json`:

```json
{
  "permissions": ["passkey:default"]
}
```

## Platform setup

Passkeys are bound to a domain, so each platform needs proof that your app owns your relying-party domain:

- **macOS** — Associated Domains entitlement + apple-app-site-association; a signed `.app` bundle is required even in dev. Full walkthrough: [macos/README.md](./macos/README.md).
- **iOS** — Associated Domains entitlement + apple-app-site-association. Full walkthrough: [ios/README.md](./ios/README.md).
- **Android** — Digital Asset Links (`assetlinks.json`) matching your signing cert. Full walkthrough: [android/README.md](./android/README.md).
- **Windows** — nothing beyond Windows 10 1903+; the origin is validated against the options you pass.
- **Linux** — nothing; a CTAP2 authenticator (USB security key or platform authenticator) is used directly.

## Usage

```typescript
import {
  register,
  authenticate,
  isPasskeyError,
} from "tauri-plugin-passkey-api";

// `creationOptions` / `requestOptions` come from your RP server and are
// standard WebAuthn JSON (PublicKeyCredentialCreationOptionsJSON etc.).
try {
  const credential = await register("https://example.com", creationOptions);
  // send `credential` back to your server to finish registration
} catch (e) {
  if (isPasskeyError(e) && e.kind === "validation") {
    // e.g. the rp.id in the options does not match the origin
  }
}

const assertion = await authenticate("https://example.com", requestOptions);
// optional third argument: timeout in milliseconds (default 60000)
```

## Errors

Every rejected promise carries a `PasskeyError`:

```typescript
{
  kind: string;
  message: string;
}
```

Current kinds: `validation` (origin/rpId mismatch and similar precondition failures), `authenticator` (the ceremony failed or was declined), `platform` (native API error), `noToken`, `io`, `serialization`, `unsupported` (a request the platform cannot fulfill by design — see [PRF](#prf)'s note on Windows and `prf.eval` at registration, and `residentKey: "discouraged"` on Android). The set is non-exhaustive — new kinds may be added in minor releases, so treat unknown kinds as generic failures. `message` is display text; do not parse it.

## PRF

The PRF contract is the same on every platform:

- `extensions.prf` is the only accepted spelling on input; results come back in
  `clientExtensionResults.prf` (`prf.enabled` after registration,
  `prf.results.{first,second}` after authentication).
- Salts may be any length and are used exactly as a browser would use them, on
  every platform — including Linux, where the CTAP2 backend derives the
  hmac-secret salt as `SHA-256("WebAuthn PRF" || 0x00 || salt)` to match what
  the browser-facing native layers do internally.
- `prf.eval` at registration is rejected with an `"unsupported"` error; register
  with `prf: {}` and evaluate salts during authentication.
- **PRF is never silently absent.** If `prf` was requested and the platform
  cannot provide it, registration still succeeds and reports
  `prf.enabled: false` — the same signal a browser gives for an authenticator
  without hmac-secret — while an assertion that requests salts fails with kind
  `unsupported` instead of returning no secret. This is uniform across
  platforms: **Windows** has no PRF support at all; **macOS below 15** and
  **iOS below 18** don't expose it either; and a **CTAP2** authenticator
  without hmac-secret hits the same rule.

## Events (Linux only)

On Linux the plugin emits interaction events (PIN required, touch required, key selection) that your UI must handle with `registerListener`, `sendPin`, and `selectKey`:

```typescript
import {
  registerListener,
  sendPin,
  selectKey,
  PasskeyEventType,
} from "tauri-plugin-passkey-api";

const unlisten = await registerListener((event) => {
  switch (event.type) {
    case PasskeyEventType.PinEvent:
      /* prompt for PIN, then sendPin(pin) */ break;
    case PasskeyEventType.SelectKey:
      /* show event.keys, then selectKey(i) */ break;
    case PasskeyEventType.PresenceRequired:
      /* "touch your key" */ break;
  }
});
```

These are no-ops on other platforms — safe to wire unconditionally.

## Example app

A complete relying-party + frontend example (including PRF, discoverable and non-discoverable flows) lives in [`test-app/`](https://github.com/dkackman/tauri-plugin-passkey/tree/main/test-app).

## Acknowledgments

This project is a derivative of [`tauri-plugin-webauthn`](https://github.com/Profiidev/tauri-plugin-webauthn)
by [ProfiiDev](https://github.com/Profiidev), itself originally forked from
[fendent/tauri-plugin-webauthn](https://github.com/fendent/tauri-plugin-webauthn). See the
[repository's NOTICE file](https://github.com/dkackman/tauri-plugin-passkey/blob/main/NOTICE)
for full attribution.

## License

MIT OR Apache-2.0
