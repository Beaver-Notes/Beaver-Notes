# iOS Passkey Support

Native passkey registration and authentication on iOS using Apple's [ASAuthorization](https://developer.apple.com/documentation/authenticationservices/asauthorization) framework. This is a Tauri mobile plugin that wraps [`ASAuthorizationPlatformPublicKeyCredentialProvider`](https://developer.apple.com/documentation/authenticationservices/asauthorizationplatformpublickeycredentialprovider) and [`ASAuthorizationSecurityKeyPublicKeyCredentialProvider`](https://developer.apple.com/documentation/authenticationservices/asauthorizationsecuritykeypublickeycredentialprovider) and exposes them to the Rust plugin via Tauri's mobile plugin system.

## How It Works

```
Tauri App (Rust)
  └─ tauri-plugin-passkey
       └─ mobile.rs (run_mobile_plugin calls)
            └─ WebauthnPlugin (Swift, Tauri Plugin)
                 ├─ WebauthnPlugin.swift - Plugin entry point, JSON parsing, response serialization
                 └─ PasskeyHandler.swift - ASAuthorizationController wrapper
```

The Rust side calls `run_mobile_plugin("register", ...)` / `run_mobile_plugin("authenticate", ...)` with JSON-serialized WebAuthn options. The Swift plugin decodes the JSON, runs the ASAuthorization flow on the main thread, serializes the credential response back to JSON, and resolves the Tauri invoke. The Rust side deserializes the JSON into `webauthn-rs-proto` types.

Unlike the macOS bridge (which uses C-callable FFI via `swift-rs`), the iOS bridge uses Tauri's native mobile plugin system. The Swift code extends Tauri's `Plugin` class and is registered via the `@_cdecl("init_plugin_passkey")` entry point.

## Consuming App Setup

These are the changes your Tauri app needs to use the iOS passkey backend.

### 1. Add the plugin dependency

In your app's `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-passkey = "0.2"
```

### 2. Register the plugin

In your app's `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_passkey::init())
    // ...
```

### 3. Add the capability

In `src-tauri/capabilities/default.json`, add the webauthn permission:

```json
{
  "permissions": ["passkey:default"]
}
```

### 4. Initialize the iOS project

If you haven't already, initialize the iOS target for your Tauri app:

```bash
pnpm tauri ios init
```

This generates the Xcode project under `src-tauri/gen/apple/`.

### 5. Add Associated Domains entitlement

Edit the entitlements file at `src-tauri/gen/apple/<app>_iOS/<app>_iOS.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.associated-domains</key>
    <array>
        <string>webcredentials:example.com</string>
    </array>
</dict>
</plist>
```

List every domain you use as an `rpId` in your WebAuthn options — each gets its own `webcredentials:` entry.

For **development builds**, you can append `?mode=developer` to bypass Apple's CDN validation:

```xml
<string>webcredentials:example.com?mode=developer</string>
```

This developer mode bypass **does** work on iOS (unlike macOS Developer ID builds), as long as the app is signed with a development certificate.

### 6. Set up Apple Developer portal

See Apple's [Configuring an Associated Domain](https://developer.apple.com/documentation/xcode/configuring-an-associated-domain) guide for full details.

1. Sign in to [Apple Developer](https://developer.apple.com/account)
2. Go to **Certificates, Identifiers & Profiles** > **Identifiers**
3. Find (or create) your App ID matching your bundle identifier
4. Enable the **Associated Domains** capability
5. Save

### 7. Set the development team

Tauri needs your Apple Development Team ID for code signing. Set it in `tauri.conf.json`:

```json
{
  "bundle": {
    "iOS": {
      "developmentTeam": "YOUR_TEAM_ID"
    }
  }
}
```

Or set the `APPLE_DEVELOPMENT_TEAM` environment variable:

```bash
export APPLE_DEVELOPMENT_TEAM=YOUR_TEAM_ID
```

You can find your Team ID at [Apple Developer > Membership](https://developer.apple.com/help/account/manage-your-team/locate-your-team-id/).

### 8. Host the Apple App Site Association file

Your server must serve an AASA file at `https://yourdomain.com/.well-known/apple-app-site-association`. See Apple's [Supporting Associated Domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains) documentation.

```json
{
  "webcredentials": {
    "apps": ["TEAM_ID.com.example.myapp"]
  }
}
```

Requirements:

- Served over HTTPS with a valid TLS certificate
- `Content-Type: application/json`
- No redirects (Apple's CDN fetches it directly)

Verify Apple's CDN has cached your file:

```bash
curl https://app-site-association.cdn-apple.com/a/v1/yourdomain.com
```

CDN propagation can take minutes to hours after first hosting the file.

**Note:** When using `?mode=developer` in the entitlement, iOS fetches the AASA directly from your server instead of Apple's CDN, which is useful during development. The AASA file must still be present and valid on your server.

### 9. Running on a physical device

Passkeys require a physical device — the iOS Simulator does not support `ASAuthorizationPlatformPublicKeyCredentialProvider`.

```bash
pnpm tauri ios dev
```

This will detect your connected device and build/deploy to it. You will need:

- An iPhone or iPad running iOS 17.4+
- The device registered in your Apple Developer account
- A valid development provisioning profile (Xcode typically manages this automatically)

### 10. Running via Xcode

You can also open the generated project in Xcode for more control over signing, debugging, and profiling:

```bash
pnpm tauri ios dev --open
```

This opens the Xcode project where you can:

- Verify code signing settings under **Signing & Capabilities**
- Confirm the **Associated Domains** capability is listed
- Set breakpoints in the Swift plugin code
- View ASAuthorization debug output in the console

## WebAuthn Server Requirements

The `rpId` in your WebAuthn options must match a domain listed in your associated domains entitlement. This is **not** the Tauri webview origin — it's your actual domain.

Example server-side registration options:

```json
{
  "rp": {
    "id": "example.com",
    "name": "My App"
  },
  "authenticatorSelection": {
    "residentKey": "required",
    "requireResidentKey": true,
    "userVerification": "preferred"
  }
}
```

`requireResidentKey: true` is required — the `webauthn-rs-proto` crate deserializes this as a non-optional `bool` field.

## Supported Authenticators

The iOS plugin registers requests for both authenticator types:

| Type         | Provider                                                | What it covers                                                               |
| ------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Platform     | `ASAuthorizationPlatformPublicKeyCredentialProvider`    | iCloud Keychain passkeys, third-party credential providers (1Password, etc.) |
| Security Key | `ASAuthorizationSecurityKeyPublicKeyCredentialProvider` | USB/NFC/BLE FIDO2 security keys                                              |

iOS presents a unified system sheet that lets the user choose between available authenticators.

## Differences from macOS

| Aspect                | macOS                                              | iOS                                       |
| --------------------- | -------------------------------------------------- | ----------------------------------------- |
| Bridge mechanism      | C-callable FFI via `swift-rs`                      | Tauri mobile plugin system                |
| Presentation anchor   | `NSWindow`                                         | `UIWindow` via `UIWindowScene`            |
| `?mode=developer`     | Does **not** work with Developer ID builds         | Works with development-signed builds      |
| Third-party providers | Not supported (no macOS Credential Provider API)   | Supported via iOS Credential Provider API |
| Minimum OS            | macOS 14 (Sonoma)                                  | iOS 17.4                                  |
| Code signing          | Developer ID + provisioning profile + notarization | Xcode-managed development signing         |
| Build command         | `pnpm tauri dev`                                   | `pnpm tauri ios dev`                      |

## Limitations

- **Simulator**: The iOS Simulator does not support passkey operations. You must use a physical device.
- **iOS version**: Requires iOS 17.4+. The `ASAuthorizationPlatformPublicKeyCredentialProvider` API predates this, but the plugin targets iOS 17.4 as the minimum deployment target so the platform authenticator can honor `excludeCredentials` (added to the platform provider in iOS 17.4).
- **Security key transports**: The plugin requests `allSupported` transports for security key credentials. Transport filtering based on the WebAuthn options is not currently implemented.

## Troubleshooting

| Error                                         | Cause                                                    | Fix                                                                                           |
| --------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Passkey APIs unavailable / registration fails | iOS version below the 17.4 minimum                       | Update the device to iOS 17.4+                                                                |
| "Application not associated with domain X"    | Domain association not validated                         | Check: AASA is hosted, entitlements include the domain, App ID has Associated Domains enabled |
| "Failed to parse registration options JSON"   | Malformed options from the Rust side                     | Verify your server returns valid WebAuthn options with all required fields                    |
| "Failed to decode base64url fields"           | Invalid base64url encoding in challenge or user ID       | Ensure the server sends properly padded base64url strings                                     |
| No passkey sheet appears                      | Missing presentation anchor or not on main thread        | This is handled by the plugin; file an issue if it occurs                                     |
| Xcode signing errors                          | Missing development team or provisioning profile         | Set `developmentTeam` in tauri.conf.json or `APPLE_DEVELOPMENT_TEAM` env var                  |
| `CARGO_CFG_TARGET_OS` build errors            | Plugin build.rs trying to link macOS Swift on iOS target | Ensure the plugin's build.rs guards Swift linking with `CARGO_CFG_TARGET_OS == "macos"`       |
