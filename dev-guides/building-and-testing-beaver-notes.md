---
description: >-
  Now that you have your development environment ready, let's move on to
  building and testing Beaver Notes.
---

# 🏗 Building and Testing Beaver Notes

{% hint style="warning" %}
Please note that building for macOS requires a Mac, and building for flatpak and snap requires Linux with a specific setups.

Keep in mind that building for different platforms may require additional dependencies or configurations. Please refer to the documentation and requirements of each platform for smooth building and packaging.
{% endhint %}

{% hint style="danger" %}
Keep in mind that Electron builder will erase the .exe package if you compile for both ARM and x64 at the same time, as both packages will have the same name. Therefore, you should build the ARM version first and add '.arm64' before the '.exe' prefix so that the package isn't deleted when you build the x64 version.
{% endhint %}

## Test the App

To initiate watch mode and continuously observe your app while developing, run:

```bash
yarn watch
```

With the watch mode active, any changes you make to the code will automatically trigger recompilation. This way, you can conveniently test your modifications on the go.

## Build the App

To build Beaver Notes, run the following command

```bash
yarn build
```

## Building the Finished Product

To build the finished product you can use the following commands

For Windows, macOS and Linux (x64):

```bash
yarn electron-builder build --config electron-builder.config.js --win --mac --linux --x64
```

For Windows, macOS and Linux (arm64):

```bash
yarn electron-builder build --config electron-builder.config.js --win --mac --linux --arm64
```

## Your Contribution Matters!

As a Beaver Notes developer, your dedication and feedback are invaluable in ensuring the stability and quality of the app. Together, we can make Beaver Notes an outstanding and user-friendly note-taking experience.

Thank you for being part of this exciting journey! If you encounter any issues, have ideas for improvements, or wish to contribute in any way, please open an issue on the Beaver Notes repository. Your efforts will undoubtedly shape the future of note-taking with Beaver Notes. Let's make it happen together! 🚀
