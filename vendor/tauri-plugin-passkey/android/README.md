# Android Passkey Support

Native passkey registration and authentication on Android using [Credential Manager](https://developer.android.com/identity/sign-in/credential-manager). This is a Tauri mobile plugin (`net.kackman.webauthn.WebauthnPlugin`) that wraps `androidx.credentials.CredentialManager` and exposes it to the Rust plugin via Tauri's mobile plugin system.

## Requirements

- Android 9+ (API 28) — set in your app's `src-tauri/gen/android/app/build.gradle.kts`:

  ```kotlin
  android {
    defaultConfig {
      minSdk = 28
    }
  }
  ```

- Google Play services (Credential Manager depends on it)
- A device or emulator with a screen lock configured — Credential Manager requires one to create or use a passkey

## Setup

### 1. Signing

A `keystore.properties` file in the `src-tauri/gen/android` directory is required to sign the app. See Tauri's [Android code signing](https://tauri.app/distribute/sign/android/) documentation for how to create it.

### 2. Digital Asset Links

Your app must be verified against your relying-party domain via [Digital Asset Links](https://developer.android.com/identity/sign-in/credential-manager#add-support-dal), or Credential Manager will refuse to create or use passkeys for that domain.

Serve an `assetlinks.json` file at `https://<rp-domain>/.well-known/assetlinks.json` listing your app's package name and the SHA-256 fingerprint of your signing certificate. You can generate the file with Google's [Digital Asset Links generator](https://developers.google.com/digital-asset-links/tools/generator).

Reference this file from your app manifest at `src-tauri/gen/android/app/src/main/AndroidManifest.xml`:

```xml
<application>
    <meta-data android:name="asset_statements" android:resource="@string/asset_statements" />
</application>
```

and define the string resource in `src-tauri/gen/android/app/src/main/res/values/strings.xml`:

```xml
<resources>
    <string name="asset_statements" translatable="false">
    [{
    \"include\": \"https://your.domain.com/.well-known/assetlinks.json\"
    }]
    </string>
</resources>
```

### 3. Getting your certificate's SHA-256 hash

To find the SHA-256 fingerprint of the keystore you sign with, for use in `assetlinks.json`:

```bash
keytool -list -v -keystore <keystore> | grep SHA256
```

## Logs

Use `../../adb-logs.sh` (from this directory) to tail device logs while debugging registration/authentication flows.
