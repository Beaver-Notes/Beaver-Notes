const packageJSON = require('./package.json');

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
    category: 'public.app-category.productivity', // macOS app category
  },
  win: {
    icon: 'buildResources/icon.ico',
    target: ['nsis'],
    publish: ['github'],
  },
  linux: {
    target: ['flatpak'],
    publish: ['github'],
    maintainer: 'Daniele Rolli <danielerolli@proton.me>',
    icon: 'buildResources/icon.png', // Replace with the actual path to your Linux icon file (48x48 or 256x256)
    packageCategory: 'Utility;TextEditor;GTK;Office;',
  },
};

module.exports = (args, arch) => {
  const config = { ...electronBuilderConfig };
  process.env.BUILD_TARGET_ARCH = arch;
  return config;
};
