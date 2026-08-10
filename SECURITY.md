# Security Policy

## Reporting Security Issues

To report or disclose a potential security-related issue in a Beaver project, please email the details to [danielerolli@beavernotes.com](mailto:danielerolli@beavernotes.com). Please include the following information, as much as possible:

1. Name of the repository affected.
2. Summary of the issue and its potential impact.
3. Versions affected (optional).
4. Technical details and proof of concept (where applicable).
5. Known mitigations or workarounds.
6. Attribution information.

We will respond to valid security disclosures within 72 hours and provide security fixes on the affected GitHub repository.

## Security Measures

### Encryption

- All note content and metadata encrypted client-side using AES-256-GCM and XChaCha20-Poly1305
- Key derivation uses Argon2id (16 MiB, 2 iterations, 2 parallelism)
- Master encryption keys stored in hardware-backed OS keychain when available
- Key rotation supported via lazy rotation without data re-encryption
- 256-bit recovery code available for key loss scenarios

### Local-First Architecture

- The app sends no analytics, trackers, or usage data
- Full functionality without creating an account
- Notes never leave your device unless you enable sync
- Beaver Sync is opt-in, with end-to-end encryption

### Access Controls

- Tauri capabilities restrict filesystem access
- Deny list blocks access to sensitive directories (~/.ssh, ~/.gnupg)
- Content Security Policy prevents script injection
- Drag-and-drop disabled to prevent file system escape

### Known Limitations

- The FTS5 full-text search index stores note content in plaintext (intentional trade-off for search functionality)
- The settings database stores preferences unencrypted (by design)
- When the OS keyring is unavailable, the master key is stored as a file with chmod 600

## Vulnerability Disclosure Timeline

1. Report received: acknowledgment within 72 hours
2. Assessment: initial severity assessment within 7 days
3. Fix developed: security fix developed and tested
4. Disclosure: coordinated disclosure after fix is available

## Scope

This security policy covers:
- Beaver-Notes desktop application (all platforms)
- Beaver-Notes mobile application (when released)

Out of scope:
- Third-party services used for optional sync
- Issues requiring physical access to the user's device
