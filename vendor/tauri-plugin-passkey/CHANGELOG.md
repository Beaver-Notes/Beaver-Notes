# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2025-05-16

### 🚀 Features

- Added cancelPin
- Added windows native webauthn
- Added option to set timeout

### 🐛 Bug Fixes

- Main thread blocking
- Added cmd permissions
- Cfg attributes incorrect

### 🚜 Refactor

- Switched to new authenticator lib for desktop
- Updated ts with new events
- Added back loggign
- Converted ctap to trait
- Removed feature and only depend on target
- Added back android

### 📚 Documentation

- Made example working again
- Add logging of expect message to example
- Fixed example on windows
- Added comments
- Updated readme

## [0.1.1] - 2025-05-13

### 🚀 Features

- Added android credential manager

### 🐛 Bug Fixes

- Rust mobile code errors
- Android compile
- Mobile cmd data transfer not working
- Made android passkey saving work

### 📚 Documentation

- Added assetslink in example
- Made android register working

### ⚙️ Miscellaneous Tasks

- Test npm publish
- Fixed scrripts
- Added node
- Removed test
- Init android in example

## [0.1.0] - 2025-05-12

### 🚀 Features

- Initial commit
- Added rust code for desktop fido2 auth
- Added js code for webauthn
- Added support for pin handling
- Added support for windows keys

### 🐛 Bug Fixes

- Removed workspace
- Wrong prettier config
- Disable release of example

### 🚜 Refactor

- Renamed from passkey to webauthn

### 📚 Documentation

- Fixed config files and added license
- Added example project
- Added registration to example
- Added authentication to example
- Made example working
- Made example work on windows

### 🎨 Styling

- Added prettier

### ⚙️ Miscellaneous Tasks

- Updated cmd permissions
- Added pipelines
- Updated cmd permissions
- Removed unused steps
- Added npm install
- Added missing apt dependencies
- Added release workflow
- Added missing tailwind prettier plugin
- Fix npm publish
- Test build
- Removed test
- _(tauri-plugin-webauthn)_ Release v0.1.0
- Added deps for release plz
- Removed changelog
