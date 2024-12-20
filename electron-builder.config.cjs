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
  files: ['packages/**/dist/**'],
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
    gatekeeperAssess: true,
    category: 'public.app-category.productivity',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Use microphone to record audio notes',
      'com.apple.security.device.audio-input': true,
    },
  },
  linux: {
    icon: 'buildResources/icon-linux.icns',
    target: ['AppImage', 'rpm', 'deb'],
    publish: ['github'],
    maintainer: 'Daniele Rolli <danielerolli@proton.me>',
    category: 'Productivity',
  },
  win: {
    artifactName: '${productName}.Setup.${version}.${arch}.exe',
    icon: 'buildResources/icon.ico',
    publish: ['github'],
    target: [
      {
        target: 'nsis',
        arch: ['x64', 'arm64'],
      },
      {
        target: 'portable',
        arch: ['x64', 'arm64'],
      },
    ],
  },
  nsis: {
    oneClick: true,
    installerIcon: 'buildResources/icon.ico',
    uninstallerIcon: 'buildResources/icon.ico',
    uninstallDisplayName: 'Beaver-Notes',
    license: 'LICENSE',
    allowToChangeInstallationDirectory: false,
    perMachine: true, // Required for file associations
  },
  fileAssociations: [
    {
      ext: 'bea',
      name: 'Beaver Notes',
      description: 'Beaver Notes File',
      icon: 'buildResources/icon.ico', // Icon for Windows
      mimeType: 'application/x-beaver-notes', // Linux-specific MIME type
    },
  ],
};

module.exports = (args, arch) => {
  const config = { ...electronBuilderConfig };

  // Set the target architecture using environment variables
  process.env.BUILD_TARGET_ARCH = arch;

  return config;
};
