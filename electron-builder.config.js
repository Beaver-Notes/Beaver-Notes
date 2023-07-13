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
  appId: "com.danielerolli.beaver-notes",
  mac: {
    icon: 'buildResources/icon.icns',
    target: ['dmg'],
    publish: ['github'],
  },
   linux: {
    icon: 'buildResources/icon.png',
    target: ['AppImage', 'deb', 'rpm'],
    publish: ['github'],
    maintainer: 'Daniele Rolli <danielerolli@proton.me>',
  },
  win: {
    icon: 'buildResources/icon.ico',
    target: ['nsis'],
    publish: ['github'],
  },
};

module.exports = (args, arch) => {
  const config = { ...electronBuilderConfig };
  
  // Set the target architecture using environment variables
  process.env.BUILD_TARGET_ARCH = arch;
  
  return config;
};
