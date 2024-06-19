const packageJSON = require('./package.json');

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const electronBuilderConfig = {
  directories: {
    output: 'dist',
    buildResources: 'buildResources',
  },
  files: [
    'packages/**/dist/**',
  ],
  extraMetadata: {
    version: packageJSON.version,
  },
  appId: 'com.danielerolli.beaver-notes',
  mac: {
    icon: 'buildResources/icon.icns',
    target: ['dmg'],
    publish: ['github'],
    hardenedRuntime: true,
    entitlements: 'buildResources/entitlements.mac.plist',
    entitlementsInherit: 'buildResources/entitlements.mac.plist',
    gatekeeperAssess: false,
    category: 'public.app-category.productivity',
  },
   linux: {
    icon: 'buildResources/icon-linux.icns',
    target: ['AppImage', 'rpm', 'deb'],
    publish: ['github'],
    maintainer: 'Daniele Rolli <danielerolli@proton.me>',
    category: 'Productivity',
  },
  win: {
    icon: 'buildResources/icon.ico',
    target: ['nsis', 'portable'],
    publish: ['github'],
  },
  nsis: {
    oneClick: true,
    installerIcon: 'buildResources/icon.ico',
    uninstallerIcon: 'buildResources/icon.ico',
    uninstallDisplayName: 'Beaver-Notes',
    license: 'LICENSE',
    allowToChangeInstallationDirectory: false,
  },
};

module.exports = (args, arch) => {
  const config = { ...electronBuilderConfig };

  // Set the target architecture using environment variables
  process.env.BUILD_TARGET_ARCH = arch;

  return config;
};
