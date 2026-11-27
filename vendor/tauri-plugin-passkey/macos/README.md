# macOS Passkey Support

Native passkey registration and authentication on macOS using Apple's [ASAuthorization](https://developer.apple.com/documentation/authenticationservices/asauthorization) framework. This bridge wraps [`ASAuthorizationPlatformPublicKeyCredentialProvider`](https://developer.apple.com/documentation/authenticationservices/asauthorizationplatformpublickeycredentialprovider) and exposes it to the Rust plugin via C-callable FFI functions.

## How It Works

```
Tauri App (Rust)
  └─ tauri-plugin-passkey
       └─ macos.rs (FFI calls)
            └─ WebauthnBridge (Swift static library)
                 ├─ Exports.swift   - C-callable functions, JSON serialization
                 └─ PasskeyHandler.swift - ASAuthorizationController wrapper
```

The Rust side calls `webauthn_register` / `webauthn_authenticate` with raw bytes (challenge, user ID, credential IDs) and a callback pointer. The Swift side runs the ASAuthorization flow on the main thread, serializes the credential response to JSON, and invokes the callback. The Rust side parses the JSON into `webauthn-rs-proto` types.

## Consuming App Setup

These are the changes your Tauri app needs to use the macOS passkey backend.

### 1. Add the plugin dependency

In your app's `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-passkey = "0.2"
```

### 2. Add Swift runtime rpath to build.rs

The Swift bridge requires the Swift concurrency runtime. Add this to your app's `src-tauri/build.rs`:

```rust
fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build();
}
```

### 3. Register the plugin

In your app's `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_passkey::init())
    // ...
```

### 4. Add the capability

In `src-tauri/capabilities/default.json`, add the webauthn permission:

```json
{
  "permissions": ["passkey:default"]
}
```

### 5. Create an Entitlements.plist

Create `src-tauri/Entitlements.plist`. See Apple's [Entitlements](https://developer.apple.com/documentation/bundleresources/entitlements) documentation for background.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.application-identifier</key>
    <string>TEAM_ID.com.example.myapp</string>
    <key>com.apple.developer.team-identifier</key>
    <string>TEAM_ID</string>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.developer.associated-domains</key>
    <array>
        <string>webcredentials:example.com</string>
        <string>webcredentials:staging.example.com</string>
    </array>
</dict>
</plist>
```

Replace `TEAM_ID` with your [Apple Developer Team ID](https://developer.apple.com/help/account/manage-your-team/locate-your-team-id/) and `com.example.myapp` with your app's bundle identifier. List every domain you use as an `rpId` in your WebAuthn options - each gets its own `webcredentials:` entry.

**Why each entitlement is needed:**

| Key                                                                                                                                                       | Purpose                                                                                                          | Apple Docs                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`com.apple.application-identifier`](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_application-identifier)             | Identifies the app to ASAuthorization. Without it: "The calling process does not have an application identifier" | [Application Identifier Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_application-identifier)   |
| [`com.apple.developer.team-identifier`](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_team-identifier)       | Pairs with the application identifier for credential scoping                                                     | [Team Identifier Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_team-identifier)       |
| [`com.apple.security.network.client`](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_network_client)           | Required for notarized apps to make outbound network connections                                                 | [Network Client Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_network_client)          |
| [`com.apple.developer.associated-domains`](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_associated-domains) | Links the app to your domain for passkey trust. Without it: "Application not associated with domain"             | [Associated Domains Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_associated-domains) |

### 6. Set up Apple Developer portal

See Apple's [Configuring an Associated Domain](https://developer.apple.com/documentation/xcode/configuring-an-associated-domain) guide for full details.

1. Sign in to [Apple Developer](https://developer.apple.com/account)
2. Go to **Certificates, Identifiers & Profiles** > **Identifiers**
3. Find (or create) your App ID matching your bundle identifier
4. Enable the **Associated Domains** capability
5. Save

### 7. Create a provisioning profile

You need a **Developer ID** provisioning profile that includes the Associated Domains capability. This profile gets embedded in the `.app` bundle so macOS can verify your entitlements are authorized. See Apple's [Distributing apps outside the App Store](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices#Create-a-provisioning-profile) documentation.

If you use [Fastlane Match](https://docs.fastlane.tools/actions/match/):

```bash
bundle exec fastlane match developer_id
```

Otherwise, create one manually in the Apple Developer portal under **Profiles** > **Developer ID**.

### 8. Code signing

The app must be signed with:

- A **Developer ID Application** certificate
- The **entitlements plist** from step 5
- The **provisioning profile** embedded in the bundle

```bash
# Embed the provisioning profile
cp /path/to/profile.provisionprofile MyApp.app/Contents/embedded.provisionprofile

# Sign with hardened runtime + entitlements
codesign --deep --force --options runtime \
  --entitlements src-tauri/Entitlements.plist \
  --sign "Developer ID Application: Your Name (TEAM_ID)" \
  MyApp.app
```

<details>
<summary>Example Fastlane lane for automated signing</summary>

This lane builds the Tauri app, discovers the provisioning profile, embeds it, signs with entitlements, and notarizes:

```ruby
lane :release do
  app_identifier = "com.example.myapp"
  team_id = "TEAM_ID"

  # Build the Tauri app (adjust to your build process)
  sh("cd ../.. && npm run tauri build")

  app_path = "../src-tauri/target/release/bundle/macos/MyApp.app"
  entitlements = "../src-tauri/Entitlements.plist"

  # Find the signing identity
  signing_identity = `security find-identity -v -p codesigning`.lines
    .find { |l| l.include?("Developer ID Application") }
    &.match(/"(.+)"/)[1]

  UI.user_error!("No Developer ID signing identity found") unless signing_identity

  # Discover provisioning profile installed by `fastlane match developer_id`
  profile_path = ENV["sigh_#{app_identifier}_developer_id_profile-path"]

  unless profile_path
    Dir.glob(File.expand_path("~/Library/Developer/Xcode/UserData/Provisioning Profiles/*.provisionprofile")).each do |p|
      content = `security cms -D -i '#{p}' 2>/dev/null`
      if content.include?(app_identifier) && content.include?("com.apple.developer.associated-domains")
        profile_path = p
        break
      end
    end
  end

  UI.user_error!("No provisioning profile found. Run: fastlane match developer_id") unless profile_path

  # Embed profile and sign
  sh("cp '#{profile_path}' '#{app_path}/Contents/embedded.provisionprofile'")
  sh("codesign --deep --force --options runtime --entitlements '#{entitlements}' --sign '#{signing_identity}' '#{app_path}'")

  # Notarize
  sh("ditto -c -k --keepParent '#{app_path}' '#{app_path}.zip'")
  sh("xcrun notarytool submit '#{app_path}.zip' --apple-id 'you@example.com' --team-id '#{team_id}' --password '@keychain:AC_PASSWORD' --wait")
  sh("xcrun stapler staple '#{app_path}'")
end
```

</details>

### 9. Notarization

Developer ID apps **must** be notarized. macOS will not process associated domain entitlements for un-notarized Developer ID apps. See Apple's [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) guide.

```bash
# Zip the app for submission
ditto -c -k --keepParent MyApp.app MyApp.zip

# Submit and wait
xcrun notarytool submit MyApp.zip \
  --apple-id "you@example.com" \
  --team-id "TEAM_ID" \
  --password "@keychain:AC_PASSWORD" \
  --wait

# Staple the ticket to the app
xcrun stapler staple MyApp.app
```

### 10. Host the Apple App Site Association file

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

### 11. Register with LaunchServices

The macOS `swcd` daemon discovers app domain claims by monitoring LaunchServices. Apps in `/Applications` are registered automatically on launch. For development builds in other locations, register manually:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /path/to/MyApp.app
```

Without this step, `swcd` won't know your app claims any domains, and passkey operations will fail with "Application not associated with domain".

You can verify the association is registered:

```bash
sudo swcutil show          # lists all registered domain associations
sudo swcutil dl -d yourdomain.com  # fetches AASA directly (bypasses CDN)
```

## WebAuthn Server Requirements

The `rpId` in your WebAuthn options must match a domain listed in your associated domains entitlement. This is **not** the Tauri webview origin (`tauri://localhost`) - it's your actual domain.

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

`requireResidentKey` is **optional** for client-generated options: the plugin normalizes browser-standard WebAuthn JSON, so if you build options in the webview and omit it (as `@simplewebauthn/browser` does), the plugin defaults it — `true` only when `residentKey` is `"required"`, otherwise `false`. Server-generated `webauthn-rs` options already include it.

### PRF / hmac-secret extension

The plugin accepts the browser `prf` extension directly and returns the browser `clientExtensionResults.prf` on the response, so it is a drop-in for clients built around the DOM WebAuthn API:

```jsonc
// registration options — enable PRF for the new credential
"extensions": { "prf": {} }

// assertion options — evaluate PRF with your per-credential salt
"extensions": { "prf": { "eval": { "first": "<base64url salt>" } } }
```

The recovered secret is at `assertion.clientExtensionResults.prf.results.first` (base64url). `extensions.prf` is the only accepted spelling — the `webauthn-rs-proto` `hmacCreateSecret` / `hmacGetSecret` shape is not accepted; register with `prf: {}` and evaluate salts during authentication. Salts may be any length; ASAuthorization applies the browser's PRF derivation internally, so the salt you pass here is used exactly as it would be in a browser.

**Requires macOS 15+.** `ASAuthorizationPublicKeyCredentialPRFAssertionInput` is only used when `#available(macOS 15.0, *)`; on macOS 14 registration still succeeds but reports `prf.enabled: false`, and an assertion that requests salts fails with an `"unsupported"` error rather than silently returning no secret.

## Limitations

- **Credential providers**: Only iCloud Keychain appears in the [ASAuthorization](https://developer.apple.com/documentation/authenticationservices/asauthorizationcontroller) sheet. Third-party providers like 1Password do not yet implement the macOS [Credential Provider API](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderextensioncontext).
- **`?mode=developer`**: The [associated domains developer mode](https://developer.apple.com/documentation/xcode/configuring-an-associated-domain#Test-the-association-during-development) bypass does **not** work with Developer ID-signed apps. It only works with Xcode development-signed builds. For Developer ID apps, the AASA must be live and cached by Apple's CDN.
- **macOS version**: Requires macOS 14+ (Sonoma). The `ASAuthorizationPlatformPublicKeyCredentialProvider` API was [introduced in macOS 12](https://developer.apple.com/documentation/authenticationservices/asauthorizationplatformpublickeycredentialprovider), but the Swift package targets macOS 14 so the platform authenticator can honor `excludeCredentials` (added to the platform provider in macOS 14).

## Troubleshooting

| Error                                                         | Cause                                                              | Fix                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| "The calling process does not have an application identifier" | Missing `com.apple.application-identifier` in entitlements         | Add it to Entitlements.plist with your Team ID + bundle ID                                  |
| "Application not associated with domain X"                    | Domain association not validated                                   | Check: AASA is live, CDN has it, profile is embedded, app is registered with LaunchServices |
| dyld: missing `libswift_Concurrency.dylib`                    | Missing Swift runtime rpath                                        | Add `-Wl,-rpath,/usr/lib/swift` to build.rs                                                 |
| "restricted entitlements... code signature validation failed" | Provisioning profile missing or doesn't include Associated Domains | Regenerate profile with Associated Domains capability enabled on the App ID                 |
| `swcutil show` has no entries for your app                    | `swcd` hasn't scanned the app                                      | Run `lsregister -f` on the .app or move it to `/Applications`                               |
| Passkey works with iCloud Keychain but not 1Password          | Expected behavior                                                  | 1Password doesn't support macOS Credential Provider API yet                                 |
