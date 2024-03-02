---
description: >-
  This page is intended for individuals who wish to redistribute or package
  Beaver for package managers and platforms not yet supported. It is not
  intended for packaging releases of the app its
---

# 📦 Packaging the app

{% hint style="info" %}
The RPM package for macOS has been discontinued since October 2023. Therefore, the only way to build an RPM package on a Mac is by installing RPM through Homebrew, as indicated in [this issue](https://github.com/orgs/Homebrew/discussions/4826#discussioncomment-7225569).
{% endhint %}

{% hint style="warning" %}
The packaging library electron-builder doesn't support flatpaks to learn more visit [the electron builder docs.](https://www.electron.build/configuration/flatpak.html)
{% endhint %}

{% hint style="success" %}
A good example of how this guide should be used, even though it wasn't created using this guide, is the [AUR repository packaged](https://aur.archlinux.org/packages/beaver-notes) by a wonderful member of our community.
{% endhint %}

### Choose your platform&#x20;

Let's suppose you are here to package Beaver Notes for your favorite package manager, whether it's for 🐧Linux, 🍎macOS, or 🪟Windows. The first thing you should do is check the package manager's website or repository for a documentation page. This will help you cover the steps we can't provide here due to the variety of package managers.

### Useful Resources

Usually you'll need the following to package an app:

* Knowledge of the Language used by the package manager
* The SHA256 of the original package or source code

You can get the SHA256 either from [Beaver Note's release page](https://github.com/Daniele-rolli/Beaver-Notes/releases) or by running the following command in your terminal or Powershell.

🪟Windows

```powershell
Get-FileHash -Algorithm SHA256 "C:\Path\to\beaver-notes.exe"
```

**🐧** Linux / 🍎 macOs

```bash
sha256sum shasum -a 256 path-to-Beaver-Notes
```

### Example

The following piece of code is an example of how a typical package manager manifest looks. Please note that this may vary from one package manager to another and is provided here for illustrative purposes only.

```ruby
  version "1.0.0"
  sha256 "f19422c18c8a4455acb36e2feef8e778dd9d4c37298761aeb51c2995fcc26b18"

    url "https://github.com/Daniele-rolli/Beaver-Notes/releases/download/#{version}/Beaver-Notes-#{version}.dmg"
  name "Beaver Notes"
  desc "Your Personal Note-Taking Haven for Privacy
and Efficiency"
  homepage "https://beavernotes.com"
  depends_on arch: :intel

  app "Beaver-notes.app"
end
```

[Link to this code snippet.](https://github.com/Daniele-rolli/homebrew-beaver/blob/main/Casks/beaver-notes.rb)

That's it you know known what you need to package Beaver Notes for your favorite repo.
