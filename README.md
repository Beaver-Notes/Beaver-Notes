<div align="center">
<div align="center">
  <img src="https://raw.githubusercontent.com/Beaver-Notes/beaver-website/main/src/assets/logo.png" alt="Beaver Logo" width="100">
</div>

  <h1>Beaver Notes</h1>

  <p><strong>Built for people who actually read privacy policies.</strong></p>
  <p>Your notes, your rules: on your device, your server, or ours.</p>

[![All Contributors](https://img.shields.io/badge/all_contributors-8-orange.svg?style=flat)](#contributors-)
![GitHub Release](https://img.shields.io/github/v/release/daniele-rolli/beaver-notes?style=flat&color=orange)
![GitHub Repo stars](https://img.shields.io/github/stars/daniele-rolli/beaver-notes?style=flat)
![GitHub forks](https://img.shields.io/github/forks/daniele-rolli/beaver-notes?style=flat)

[Website](https://beavernotes.com) · [Blog](https://blog.beavernotes.com) · [Docs](https://docs.beavernotes.com) · [Downloads](https://beavernotes.com/#/Download) · [Roadmap](https://github.com/orgs/Beaver-Notes/projects/5)

</div>

---

> **You're on the `tauri` branch. The v5 rewrite.** This is where Beaver Notes is heading. The current stable release lives on [`development`](https://github.com/Beaver-Notes/Beaver-Notes/tree/development).

Most note-taking apps make the same quiet trade: your convenience in exchange for access to your data. It's easy to miss in the onboarding flow, buried somewhere in a terms-of-service document most people never open.

Beaver Notes starts from a different place. Your notes live on your device. They're not indexed, not processed, not readable by anyone but you. When you want to sync, you choose how, your own cloud storage, a self-hosted server, or BeaverSync (coming later this year) if you'd rather not think about it. No vendor lock-in either way.

We're rebuilding Beaver Notes from the ground up in Tauri for v5, faster, smaller, and properly cross-platform, including mobile, because we outgrew our original Electron foundation.

![Beaver Notes demo](https://github.com/Beaver-Notes/Beaver-Notes/assets/67503004/a7b38689-0363-49f0-8ed8-60e7358b1df6)

## What it is

Beaver Notes is a local-first, markdown-native notes app for macOS, Windows, Linux, Android, and iOS. It has folders, tags, note linking, locked notes, and flexible sync. It starts fast. It works offline. It doesn't ask you to create an account to use it.

The things that make it worth switching to aren't features. It's the absence of things. Beaver has no telemetry in the editor, no account wall, no monthly fee to keep your notes accessible and no moment where you wonder who else can read what you're writing.

## What's new in v5

Version 5 is a rewrite, not an update. We moved from Electron to Tauri, which means meaningfully smaller binaries and better native behaviour on every platform. More importantly, mobile is no longer a separate app, Beaver Pocket is being folded into Beaver Notes itself, so the experience is consistent whether you're on a laptop in a coffee shop or on your phone at 2am.

We're also adding things people have asked for since the early days: real-time collaboration, version history, backlinks, and a plugin system. These were hard to build correctly on the old architecture. On the new one, they're not.

The [roadmap](https://github.com/orgs/Beaver-Notes/projects/5) is public if you want to follow along or push back on priorities.

## Installing v5 (beta)

> v5 is in active development. It will have rough edges. We'd genuinely love bug reports.

```bash
git clone https://github.com/Beaver-Notes/Beaver-Notes.git
cd Beaver-Notes
git checkout tauri
yarn install
yarn tauri dev
```

For stable builds, the [Downloads page](https://beavernotes.com/#/Download) has installers for every platform. Package managers (AUR, Flatpak, Scoop, Brew) will track stable once v5 ships.

## Contributing

Beaver Notes exists because people decided to build something better and kept showing up. The contributors below translated strings, wrote code, caught bugs, improved docs, and packaged the app for platforms we'd have missed. That kind of work is what makes the difference between a project that goes somewhere and one that doesn't.

If you want to get involved, whether that's code, translations, design, or just a well-written bug report, the [contributing guide](<https://docs.beavernotes.com/beaver%20notes%20(dev)/2025/01/03/How-to-contribute.html>) is a good place to start.

The community is on [Reddit](https://www.reddit.com/r/BeaverNotes/), [Mastodon](https://mastodon.social/@Beavernotes), and [Bluesky](https://bsky.app/profile/beavernotes.com). For everything else: [danielerolli@proton.me](mailto:danielerolli@proton.me).

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="http://bigshans.github.io"><img src="https://avatars.githubusercontent.com/u/26884666?v=4?s=100" width="100px;" alt="Algernon"/><br /><sub><b>Algernon</b></sub></a><br /><a href="https://github.com/Beaver-Notes/Beaver-Notes/issues?q=author%3Abigshans" title="Bug reports">🐛</a> <a href="#translation-bigshans" title="Translation">🌍</a> <a href="https://github.com/Beaver-Notes/Beaver-Notes/commits?author=bigshans" title="Code">💻</a> <a href="#maintenance-bigshans" title="Maintenance">🚧</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/eag75"><img src="https://avatars.githubusercontent.com/u/155111097?v=4?s=100" width="100px;" alt="Danny Schellnock"/><br /><sub><b>Danny Schellnock</b></sub></a><br /><a href="#translation-eag75" title="Translation">🌍</a> <a href="#maintenance-eag75" title="Maintenance">🚧</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/kant"><img src="https://avatars.githubusercontent.com/u/32717?v=4?s=100" width="100px;" alt="Darío Hereñú"/><br /><sub><b>Darío Hereñú</b></sub></a><br /><a href="https://github.com/Beaver-Notes/Beaver-Notes/commits?author=kant" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/mee141"><img src="https://avatars.githubusercontent.com/u/93583530?v=4?s=100" width="100px;" alt="mee_"/><br /><sub><b>mee_</b></sub></a><br /><a href="#translation-mee141" title="Translation">🌍</a> <a href="#maintenance-mee141" title="Maintenance">🚧</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://www.eave.fyi"><img src="https://avatars.githubusercontent.com/u/978899?v=4?s=100" width="100px;" alt="Bryan Ricker"/><br /><sub><b>Bryan Ricker</b></sub></a><br /><a href="https://github.com/Beaver-Notes/Beaver-Notes/commits?author=bricker" title="Documentation">📖</a> <a href="#translation-bricker" title="Translation">🌍</a> <a href="https://github.com/Beaver-Notes/Beaver-Notes/commits?author=bricker" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://olavrb.no"><img src="https://avatars.githubusercontent.com/u/6450056?v=4?s=100" width="100px;" alt="Olav Rønnestad Birkeland"/><br /><sub><b>Olav Rønnestad Birkeland</b></sub></a><br /><a href="#platform-o-l-a-v" title="Packaging/porting to new platform">📦</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://tahinli.com"><img src="https://avatars.githubusercontent.com/u/96421894?v=4?s=100" width="100px;" alt="Ahmet Kaan GÜMÜŞ"/><br /><sub><b>Ahmet Kaan GÜMÜŞ</b></sub></a><br /><a href="#translation-Tahinli" title="Translation">🌍</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="http://rianorie.com"><img src="https://avatars.githubusercontent.com/u/2292861?v=4?s=100" width="100px;" alt="Rian Orie"/><br /><sub><b>Rian Orie</b></sub></a><br /><a href="#design-rianorie" title="Design">🎨</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://olivelton.com/links"><img src="https://avatars.githubusercontent.com/u/124373744?v=4?s=100" width="100px;" alt="Olivelton Santos"/><br /><sub><b>Olivelton Santos</b></sub></a><br /><a href="#translation-oliveltonsantos" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/razzeee"><img src="https://avatars.githubusercontent.com/u/5943908?v=4?s=100" width="100px;" alt="Kolja"/><br /><sub><b>Kolja</b></sub></a><br /><a href="#platform-razzeee" title="Packaging/porting to new platform">📦</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/markd91"><img src="https://avatars.githubusercontent.com/u/44508986?v=4?s=100" width="100px;" alt="markd91"/><br /><sub><b>markd91</b></sub></a><br /><a href="https://github.com/Beaver-Notes/Beaver-Notes/commits?author=markd91" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

Also: Verthandii, [Mondstern](https://moooon.dresden.network/), Gabriel Soleil, and Rem, for translations and community work that rarely shows up in commit graphs but matters just as much.

## Support

Beaver Notes is free. It will stay free. If it's been useful to you, the most valuable things you can do are tell someone about it and file a bug when you find one.

If you'd like to contribute financially:

<div align="center">
  <a href="https://www.buymeacoffee.com/beavernotes">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" height="50" width="210" alt="Buy me a coffee" />
  </a>
  <a href="https://ko-fi.com/danielerollibeavernotes">
    <img src="https://cdn.ko-fi.com/cdn/kofi3.png?v=3" height="50" width="210" alt="Support on Ko-Fi" />
  </a>
</div>
