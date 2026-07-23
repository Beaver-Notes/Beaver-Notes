# Contributing to Beaver Notes

First off, thank you for considering contributing to Beaver Notes. It's people like you that make Beaver Notes such a great tool.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Setup](#setup)
  - [Environment Variables](#environment-variables)
- [Project Overview](#project-overview)
  - [Tech Stack](#tech-stack)
  - [Architecture](#architecture)
  - [Key Directories](#key-directories)
- [Development Workflow](#development-workflow)
  - [Running the App](#running-the-app)
  - [Linting](#linting)
  - [Pre-commit Hooks](#pre-commit-hooks)
- [Making Changes](#making-changes)
  - [Branching](#branching)
  - [Commit Messages](#commit-messages)
  - [Developer Certificate of Origin](#developer-certificate-of-origin)
  - [AI-Generated Content](#ai-generated-content)
- [Pull Requests](#pull-requests)
- [Building](#building)
  - [Desktop](#desktop)
  - [Mobile](#mobile)
  - [Beta Builds](#beta-builds)
- [Translations](#translations)
- [Release Process](#release-process)
- [Reporting Issues](#reporting-issues)
- [Security](#security)
- [License](#license)

## Code of Conduct

This project and everyone participating in it is governed by the [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [danielerolli@proton.me](mailto:danielerolli@proton.me).

## Getting Started

### Prerequisites

- **Node.js** >= v18.0.0
- **Yarn 1.x** (Classic): `npm install -g yarn`
- **Rust toolchain** >= 1.77.2: install via [rustup](https://rustup.rs/)
- **Tauri system dependencies**: see the [Tauri v2 prerequisites guide](https://v2.tauri.app/start/prerequisites/)

#### Mobile targets (optional)

- **iOS:** Xcode 16+, CocoaPods
- **Android:** Android Studio, Android NDK, Java 17+

### Setup

```bash
git clone https://github.com/Beaver-Notes/Beaver-Notes.git
cd Beaver-Notes
yarn install
```

### Environment Variables

Copy the example environment file:

```bash
cp .env.development.example .env.development
```

Fill in the values:

| Variable              | Description                                           |
|----------------------|-------------------------------------------------------|
| `VITE_DEV_SERVER_URL` | Dev server URL (default: `http://localhost:5173`)    |
| `PROJECT_ID`          | Project identifier for Traduora                      |
| `CLIENT_ID`           | Traduora client ID                                   |
| `CLIENT_SECRET`       | Traduora client secret                               |

## Project Overview

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Vue 3 + Vite 5 + Pinia + Vue Router (hash mode) |
| **Styling** | Tailwind CSS 3, SCSS, tw-colors themes |
| **Editor** | tiptap (ProseMirror-based), KaTeX, Mermaid |
| **Desktop** | Tauri 2 (Rust backend) |
| **Mobile** | Tauri 2 (iOS + Android) |
| **Database** | SQLite via rusqlite (Rust side) |
| **Sync** | Yjs (CRDT-based collaboration) |
| **Linting** | ESLint + Prettier |

### Architecture

Beaver Notes is a Tauri v2 application:

- **`src/`**: Vue 3 frontend (the "web" layer)
- **`src-tauri/`**: Rust backend (the "native" layer)
- The Rust backend handles file system access, encryption, search, updates, and the SQLite database
- The frontend communicates with the backend via Tauri's `invoke` command system

### Key Directories

```
src/
  components/         -- Vue components (ui/, app/, note/, home/, onboarding/)
  composable/         -- Vue composables (state management, utilities)
  pages/              -- Route page components
  store/              -- Pinia stores (app, note, folder, label, i18n, passwd)
  assets/             -- CSS, fonts, images, SVG, translations (locales/)
  lib/                -- Core libraries (tiptap extensions, Tauri bridge, dayjs, etc.)
  utils/              -- Utility functions (crypto, sync, import/export, share)

src-tauri/
  src/                -- Rust source (commands/, lib.rs, main.rs, db.rs, etc.)
  tauri.conf.json     -- Tauri configuration
  Cargo.toml          -- Rust dependencies
```

## Development Workflow

### Running the App

```bash
yarn watch
```

This spawns `tauri dev` with proper process tree cleanup. The Vite dev server runs on `http://localhost:5173`.

> **Note:** For the first run, `tauri dev` will compile all Rust crates, which can take a few minutes.

### Linting

```bash
yarn lint
```

Uses ESLint with the `vue3-recommended` and `prettier-vue` configurations. All `.js`, `.ts`, and `.vue` files are linted.

### Pre-commit Hooks

Pre-commit hooks are managed via Husky and run `lint-staged`:

```bash
# .husky/pre-commit runs:
yarn lint-staged
# Which lints *.js, *.ts, *.vue files with eslint --cache --fix
```

If a commit is rejected due to linting errors, fix the errors and try again.

## Making Changes

### Branching

Use descriptive branch names:

- `fix/description` for bug fixes
- `feat/description` for new features
- `refactor/description` for code refactoring
- `docs/description` for documentation changes

### Commit Messages

We do not enforce a strict convention, but prefer clear, descriptive commit messages written in the imperative mood. For example:

- "fix: Fix crash when deleting a folder with locked notes"
- "feat: Add search-as-you-type to the home page"

### Developer Certificate of Origin

All commits must include a `Signed-off-by` trailer to certify that you have the right to submit the work under the MIT license. This is the [Developer Certificate of Origin](https://developercertificate.org/) (DCO) v1.1.

```bash
git commit -s -m "Your commit message"
```

If you forget `-s`, you can amend:

```bash
git commit --amend -s --no-edit
```

See [DCO.md](./DCO.md) for the full text.

### AI-Generated Content

If you use AI tools (e.g., ChatGPT, Copilot, Claude) to generate or assist with code, you **must** disclose this in your commit or pull request using one of these commit trailers:

- `Assisted-by: <tool-name> <version>`
- `Co-authored-by: <tool-name> <version>`
- `Generated-by: <tool-name> <version>`

You remain fully accountable for any AI-generated code. See [AI_POLICY.md](./AI_POLICY.md) for full details.

## Pull Requests

1. **Create an issue** first if the change is non-trivial (bug, feature, refactor). This avoids duplicate work.
2. **Keep PRs focused** each PR should address a single concern.
3. **Ensure linting passes** run `yarn lint` before submitting.
4. **Update translations** if your change adds or modifies user-facing strings.
5. **Include a clear description** what, why, and how.
6. **Checklist in PR template** fill it out when you open the PR.

All PRs are reviewed before merging. Maintainers may request changes.

## Building

### Desktop

```bash
yarn build
# or equivalently:
yarn build:desktop
```

Produces platform-specific bundles:

- **macOS:** `.dmg` + universal binary
- **Linux:** `.AppImage`, `.deb`, `.rpm`, `.tar.gz`
- **Windows:** `.exe` (NSIS installer), `.zip`

### Mobile

```bash
# iOS - first time only:
yarn mobile:init:ios

# Run on iOS simulator:
yarn dev:ios "iPhone 16"

# Build iOS:
yarn build:ios

# Android - first time only:
yarn mobile:init:android

# Run on Android emulator/device:
yarn dev:android

# Build Android:
yarn build:android
```

#### iOS - Simulator Boot Order

Before running `yarn dev:ios`, the simulator must be booted first:

```bash
xcrun simctl boot "iPhone 16e"
open -a Simulator
# Wait for the home screen to appear, then:
yarn dev:ios "iPhone 16e"
```

#### Android - libsodium Pre-build (one-time setup)

The `tauri-plugin-stronghold` dependency requires libsodium for Android ARM64. Build it once per machine:

```bash
cd /tmp
curl -LO https://download.libsodium.org/libsodium/releases/LATEST.tar.gz
tar xzf LATEST.tar.gz
cd libsodium-stable
export ANDROID_NDK_HOME=~/Library/Android/sdk/ndk/$(ls ~/Library/Android/sdk/ndk | tail -1)
export NDK_PLATFORM=android-28
./dist-build/android-armv8-a.sh
mkdir -p ~/.libsodium-android
cp -r /tmp/libsodium-stable/libsodium-android-armv8-a+crypto/* ~/.libsodium-android/
```

Then add to your shell profile:

```bash
export SODIUM_LIB_DIR="$HOME/.libsodium-android/lib"
```

Reload and build:

```bash
cd src-tauri
cargo clean --target aarch64-linux-android
cd ..
yarn build:android
```

> **Note:** `tauri-plugin-stronghold` is planned for deprecation in Tauri v3. The long-term replacement is platform-native backends: `keyring` (desktop) and `keystore` (mobile).

### Beta Builds

```bash
yarn dev:beta     # Development with beta config
yarn build:beta   # Build with beta config
```

## Translations

Translations are stored as JSON files in `src/assets/locales/`.

| Language | Code |
|----------|------|
| Arabic | `ar` |
| German | `de` |
| English | `en` |
| Spanish | `es` |
| French | `fr` |
| Italian | `it` |
| Dutch | `nl` |
| Portuguese | `pt` |
| Russian | `ru` |
| Turkish | `tr` |
| Ukrainian | `uk` |
| Vietnamese | `vi` |
| Chinese | `zh` |

**To add a new translation:**

1. Create a new JSON file in `src/assets/locales/` using the language code as filename (e.g., `ja.json`).
2. Translate all keys from the English (`en.json`) file.
3. Open a PR with the new locale.

**To update existing translations:**

- Edit the relevant JSON file directly, or use the utility scripts:

```bash
yarn tran-util       # Translation utility
yarn tran-update     # Update translations from source
```

## Release Process

Releases are automated via GitHub Actions.

### Stable Release

1. Bump the version:

   ```bash
   node scripts/bump-version.mjs
   ```

   This syncs `package.json`, `Cargo.toml`, and `tauri.conf.json`.

2. Push a tag matching `v[0-9]+.[0-9]+.[0-9]+` (e.g., `v5.0.0`):
   ```bash
   git tag v5.0.0
   git push origin v5.0.0
   ```
   The [release.yml](.github/workflows/release.yml) workflow builds for all platforms and creates a draft release.

### Beta Release

1. Bump the version to a beta pre-release:

   ```bash
   node scripts/bump-version.mjs
   ```

2. Push a tag matching `v*-beta.*` (e.g., `v5.0.0-beta.1`):
   ```bash
   git tag v5.0.0-beta.1
   git push origin v5.0.0-beta.1
   ```
   The [release-beta.yml](.github/workflows/release-beta.yml) workflow builds with the beta Tauri config and creates a prerelease.

## Reporting Issues

Use the appropriate issue template:

- [Bug Report](https://github.com/Beaver-Notes/Beaver-Notes/issues/new?template=bug_report.md) - for crashes, unexpected behavior, etc.
- [Feature Request](https://github.com/Beaver-Notes/Beaver-Notes/issues/new?template=feature_request.md) - for new ideas and enhancements
- [Question / Help](https://github.com/Beaver-Notes/Beaver-Notes/issues/new?template=ask-a-question-or-get-help.md) - if you need assistance

## Security

Found a security vulnerability? **Do not open a public issue.** Email [danielerolli@proton.me](mailto:danielerolli@proton.me) with details. See [SECURITY.md](./SECURITY.md).

## License

Beaver Notes is open source software licensed under the [MIT license](./LICENSE).
