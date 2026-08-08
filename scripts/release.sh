#!/bin/bash
set -euo pipefail

VERSION="${1:-$(node -p "require('./package.json').version")}"
TAG="v$VERSION"
TARGET="aarch64-apple-darwin"
NOTARY_PROFILE="${NOTARY_PROFILE:-beaver-notes-notary}"

SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning \
  | awk -F'"' '/Developer ID Application/{print $2; exit}')}"

if [ -z "$SIGNING_IDENTITY" ]; then
  echo "ERROR: No Developer ID Application certificate found in login keychain."
  echo "Install it first, or set APPLE_SIGNING_IDENTITY."
  exit 1
fi

echo "==> Signing identity: $SIGNING_IDENTITY"
echo "==> Version: $VERSION (tag: $TAG)"
echo "==> Target: $TARGET"
echo ""

# Checks
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

if [ "$(git branch --show-current)" != "main" ]; then
  echo "ERROR: Not on main branch."
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "ERROR: Tag $TAG already exists."
  exit 1
fi

echo "==> Verifying notary profile..."
xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 || {
  echo "ERROR: Notary profile '$NOTARY_PROFILE' not found."
  echo "Create it with:"
  echo "  xcrun notarytool store-credentials $NOTARY_PROFILE \\"
  echo "    --apple-id you@x.com --team-id F8U6VTU2DJ"
  exit 1
}

echo "==> Checking for prerelease suffix..."
if [[ "$VERSION" == *"-"* ]]; then
  echo "WARNING: Prerelease version detected. Use release-beta.yml for CI builds."
  echo "  For a local stable release, run: node scripts/bump-version.mjs <semver>"
fi

# Bump
echo "==> Bumping version..."
node scripts/bump-version.mjs "$VERSION"

# Quality gate
echo "==> Quality gate..."
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml

# Sign any sideloaded dylibs (if present)
for dylib in $(find src-tauri -path "*/target/*" -prune -o -name "*.dylib" -print 2>/dev/null); do
  echo "==> Signing sideloaded dylib: $dylib"
  codesign --force --timestamp --options runtime --sign "$SIGNING_IDENTITY" "$dylib"
done

# Build
echo "==> Building for $TARGET..."
APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY" yarn tauri build --target "$TARGET" --bundles dmg

DMG=$(find "src-tauri/target/$TARGET/release/bundle/dmg" -name "*.dmg" -type f | head -1)
if [ -z "$DMG" ]; then
  echo "ERROR: DMG not found."
  exit 1
fi
echo "==> DMG: $DMG"

# Notarize
echo "==> Notarizing... ($(date -u +%FT%TZ))"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
echo "==> Notarization done ($(date -u +%FT%TZ))"

echo "==> Stapling..."
xcrun stapler staple "$DMG"

echo "==> Verifying..."
spctl -a -t open --context context:primary-signature -vv "$DMG"

# Commit and tag
echo "==> Committing and tagging..."
git add -A
git commit -m "$TAG"
git tag "$TAG"

echo ""
echo "============================================"
echo "  Release $TAG ready."
echo "  Push with:"
echo "    git push origin main $TAG"
echo ""
echo "  Create release with:"
echo "    gh release create $TAG \"$DMG\" --title \"Beaver Notes $VERSION\" --generate-notes"
echo "============================================"
