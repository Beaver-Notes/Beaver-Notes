# 🚀 Installation

To get started with Beaver Notes, visit the website at [beavernotes.com](https://beavernotes.com/download) and navigate to the download section. Choose the installer that matches your operating system – whether it's macOS, Windows, or a Linux distribution. Once you've selected the right installer, you can either go on and follow on-screen instructions or keep reading this section of the docs for better guidance.



{% hint style="info" %}
**Not sure which installer to pick? No worries! We are here to help you just click here**

🪟 **Windows**: Press Windows Key + R, then type msinfo32 and hit Enter. Look for the System Type under System Information to find whether it's x64 or arm64.

\
🍎 **macOS**: Click the Apple menu in the top-left corner, choose About This Mac, and look for the Processor information. It will specify whether it's an Intel (x64) or Apple Silicon (arm64) processor.

\
🐧 **Linux**: Open a terminal and use the command uname -m. If it returns x86\_64, it's x64 architecture. If it returns aarch64, it's arm64 architecture.
{% endhint %}

## 🍎 **macOS**

#### &#x20;**Using a .dmg**

Once the download is complete, double-click the .dmg file in your download folder to mount the Beaver Notes disk image. From there, just drag the Beaver Notes app icon onto your Applications folder.

When you open the app, a pop-up shows up saying "Beaver Notes" cannot be opened because the developer cannot be verified, macOS cannot verify that this app is free from malware. Click "OK," and then go to System Preferences > Privacy & Security > and click "Open Anyway"

If you want to ensure the safety of what you are running, you can check the installer’s SHA256 to verify if the code has been tampered with. To obtain the SHA256 of the installer on your Mac, run

```bash
shasum -a 256 path-to-Beaver-Notes.dmg
```

in the terminal, and compare it with the one corresponding to your installer [Release](https://github.com/Daniele-rolli/Beaver-Notes/releases).

#### &#x20;**🍺 HomeBrew**

To install Beaver Notes through HomeBrew and get the convenience of easy upgradability run the following commands in your mac's terminal

Add the tap to Homebrew

```bash
brew tap Daniele-rolli/homebrew-beaver https://github.com/Daniele-rolli/homebrew-beaver.git
```

Install Beaver-notes (On Apple Silicon Macs)

```bash
brew install beaver-notes-arm
```

Install Beaver-notes (On Intel macs)

```bash
brew install beaver-notes
```

## 🪟 **Windows**

When the download finishes, double-click on the installer to initiate the installation process. Like macOS, Windows has a protection feature for packages downloaded from the internet. Therefore, a pop-up saying “Windows protected your PC - Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk.“ will appear. Click on 'More info' and then 'Run anyway' as the app has no other terms to agree to. The installer will as you to accept the MIT license and proceed to install the app.

To verify that the code has not been subject to malicious modifications, check the SHA256 by running in Powershell:

```powershell
Get-FileHash -Algorithm SHA256 "C:\Path\to\beaver-notes.exe"
```

#### **🍦 Scoop**

To install Beaver Notes through Scoop and get the delicious convenience of easy upgradability run the following commands in your PC's Powershell

```powershell
scoop bucket add Beaver-Bucket https://github.com/Daniele-rolli/Beaver-Bucket
```

To install Beaver Notes on x64:

```powershell
scoop install Beaver-Notes
```

To install Beaver Notes on arm64:

```powershell
scoop install Beaver-Notes-arm
```

## 🐧 Linux&#x20;

If your distribution is based on Debian or Fedora, such as Ubuntu, Linux Mint, Zorin OS, and others, you have the choice to install the software using either an AppImage package, the apt repo, or an .rpm package. For Arch Linux users an AUR repository is available otherwise for Arch and similar distributions, the AppImage package is also available, tho a repo is recommended.

**📦 Debian / Ubuntu Packages**

To install Beaver Notes through apt, copy and paste the commands below in your terminal:

Fetching Repository GPG Key

```bash
curl -s --compressed https://daniele-rolli.github.io/Beaver-notes-ppa/KEY.gpg | gpg --dearmor | sudo tee /etc/apt/trusted.gpg.d/Beaver-notes-ppa.gpg >/dev/null
```

Add Beaver Notes' Repository

```bash
sudo curl -s --compressed -o /etc/apt/sources.list.d/Beaver_notes_file.list https://daniele-rolli.github.io/Beaver-notes-ppa/Beaver_notes_file.list
```

Update the Package Lists

```bash
sudo apt update
```

Install Beaver Notes

```bash
sudo apt install beaver-notes
```

**🔩 AUR (Arch and derivates)**

To install Beaver Notes on Arch Linux through the AUR using Yay, follow the commands below:

Install Yay's dependencies

```bash
sudo pacman -S base-devel git
```

Clone Yay's repository and navigate to the directory

```bash
git clone https://aur.archlinux.org/yay.git && cd yay
```

Install Yay

```bash
makepkg -si
```

Install Beaver Notes

```bash
yay -S beaver-notes
```

**Fedora**&#x20;

install the .rpm package by running

```bash
sudo rpm -i path/to/Beaver-Notes.rpm
```

{% hint style="info" %}
Replace 'path/to/Beaver-Notes.rpm' with the actual path to the downloaded file.
{% endhint %}

**Appimage**

Run the command

```bash
chmod +x path/to/Beaver-Notes.AppImage
```

{% hint style="info" %}
Replace 'path/to/Beaver-Notes.AppImage' with the actual path to the downloaded file.
{% endhint %}

To launch Beaver Notes, either double-click the AppImage file or run it from the terminal using:

```
./path/to/Beaver-Notes.AppImage
```

To integrate AppImages into your system, consider installing AppImageLauncher. For more information, visit their [GitHub repository.](https://github.com/TheAssassin/AppImageLauncher)

Now that you've installed Beaver Notes successfully check out the next page to better understand the app's interface
