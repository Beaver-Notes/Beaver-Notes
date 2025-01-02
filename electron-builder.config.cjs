const packageJSON = require('./package.json');
const { loadEnv } = require('./env.js');

loadEnv('private');

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const electronBuilderConfig = {
  appId: 'com.danielerolli.beaver-notes',
  files: ['packages/**/dist/**'],
  extraMetadata: {
    version: packageJSON.version,
  },
  directories: {
    output: 'dist',
    buildResources: 'buildResources',
  },
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
    {
      provider: 'github',
      releaseType: 'draft',
    },
  ],
  mac: {
    icon: 'buildResources/icon.icns',
    target: [
      {
        target: 'dmg',
        arch: ['universal'],
      },
    ],
    hardenedRuntime: true,
    entitlements: 'buildResources/entitlements.mac.plist',
    entitlementsInherit: 'buildResources/entitlements.mac.plist',
    gatekeeperAssess: true,
    category: 'public.app-category.productivity',
    extendInfo: {
      'com.apple.security.device.audio-input': true,
    },
    notarize: {
      teamId: process.env.APPLE_TEAM_ID,
    },
  },
  linux: {
    icon: 'buildResources/icon-linux.icns',
    target: [
      {
        target: 'AppImage',
        arch: ['x64', 'arm64'],
      },
      {
        target: 'rpm',
        arch: ['x64', 'arm64'],
      },
      {
        target: 'deb',
        arch: ['x64', 'arm64'],
      },
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
  },
  nsis: {
    oneClick: true,
    installerIcon: 'buildResources/icon.ico',
    uninstallerIcon: 'buildResources/icon.ico',
    uninstallDisplayName: 'Beaver-Notes',
    license: 'LICENSE',
    allowToChangeInstallationDirectory: false,
  },
  portable: {
    artifactName: '${productName}-${version}-portable.${ext}',
  },
};

module.exports = () => {
  const config = { ...electronBuilderConfig };

  return config;
};
