const packageJSON = require('./package.json');
const { azuresigntool } = require('@ossign/azuresigntool');
const os = require('os');
const path = require('path');

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const electronBuilderConfig = {
  appId: 'com.danielerolli.beaver-notes',
  productName: 'Beaver Notes',
  asar: true,
  asarUnpack: ['**/*.node'],
  files: [
    'packages/**/dist/**',
    'LICENSE',
    'package.json',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/README.md',
    '!**/CHANGELOG.md',
    '!**/docs{,/**}',
    '!**/test{,/**}',
    '!**/__tests__{,/**}',
    '!**/fixtures{,/**}',
    '!**/scripts{,/**}',
    '!**/.*/**',
  ],
  compression: 'maximum',
  extraMetadata: { version: packageJSON.version },
  directories: { output: 'dist', buildResources: 'buildResources' },
  fileAssociations: [
    {
      ext: 'bea',
      name: 'Beaver Notes',
      description: 'Beaver Notes File',
      icon: 'buildResources/icon.ico',
      mimeType: 'application/x-beaver-notes',
    },
  ],
  publish: [
    { provider: 'github', releaseType: 'draft', vPrefixedTagName: false },
  ],

  mac: {
    icon: 'buildResources/icon.icns',
    target: [{ target: 'default', arch: ['universal'] }],
    hardenedRuntime: true,
    entitlements: 'buildResources/entitlements.mac.plist',
    entitlementsInherit: 'buildResources/entitlements.mac.plist',
    gatekeeperAssess: true,
    category: 'public.app-category.productivity',
    extendInfo: { 'com.apple.security.device.audio-input': true },
    notarize: false,
  },

  linux: {
    icon: 'buildResources/icon-linux.icns',
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'rpm', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
      { target: 'tar.gz', arch: ['x64', 'arm64'] },
    ],
    maintainer: 'Daniele Rolli <danielerolli@proton.me>',
    category: 'Productivity',
  },

  win: {
    icon: 'buildResources/icon.ico',
    target: [
      { target: 'portable', arch: ['x64', 'arm64'] },
      { target: 'nsis', arch: ['x64', 'arm64'] },
    ],
    sign: process.env.AST_TD === 'SHA256' ? azuresigntool : undefined,
  },

  nsis: {
    oneClick: true,
    installerIcon: 'buildResources/icon.ico',
    uninstallerIcon: 'buildResources/icon.ico',
    uninstallDisplayName: 'Beaver-Notes',
    license: 'LICENSE',
    allowToChangeInstallationDirectory: false,
  },

  portable: { artifactName: '${productName}-${version}-portable.${ext}' },
  afterSign:
    os.platform() === 'darwin'
      ? async (context) => {
          const { default: notarizing } = await import(
            './scripts/notarize.mjs'
          );
          return notarizing(context);
        }
      : undefined,
  afterPack: async (context) => {
    const fs = require('fs');
    const { appOutDir, packager } = context;
    const platform = packager.platform?.name;
    const localesDir =
      platform === 'mac'
        ? path.join(
            appOutDir,
            `${packager.appInfo.productFilename}.app`,
            'Contents',
            'Resources',
            'locales'
          )
        : path.join(appOutDir, 'locales');

    try {
      const keep = new Set(['en-US.pak']);
      if (fs.existsSync(localesDir)) {
        for (const f of fs.readdirSync(localesDir)) {
          if (!keep.has(f))
            fs.rmSync(path.join(localesDir, f), { force: true });
        }
      }
    } catch (e) {
      console.warn('Locale pruning failed:', e);
    }
  },
};

module.exports = async () => {
  const envModule = await import('./env.js');
  envModule.loadEnv('private');
  return electronBuilderConfig;
};
