---
description: >-
  Dive into contributing by setting up your local development environment.
  Follow these steps to clone the Beaver Notes repository and get ready for
  action.
---

# 🛠 Setup Your Environment

{% hint style="warning" %}
Please note that specific system-dependent packages might be required, such as rpm for building .rpm packages or different libraries to ensure compatibility. If you encounter any issues while setting up your environment, please open a GitHub issue with the following details:

* Operating system and version
* Architecture of your system
* Description of the issue you are facing
* Output of the command that triggered the issue
{% endhint %}

### Installing the dependencies

**Install Git**

Before you start contributing to Beaver Notes, ensure you have Git installed on your computer. If you don't have Git installed, you can download and install it from the official website: [https://git-scm.com/](https://git-scm.com/)

**Install Node.js and npm**

Beaver Notes requires Node.js (v16) and npm (Node Package Manager) to build and run. If you don't have Node.js and npm installed, you can download them from the official [Node.js website](https://nodejs.org/en/blog/release/v16.16.0)

**Install Yarn**

Once you have Node.js and npm installed, you can use npm to install Yarn globally by running the following command in your terminal or command prompt:

```bash
npm install -g yarn
```

## Setup the Repo

#### Fork the Beaver Notes Repository

To contribute to the Beaver Notes project, you'll need to fork the official repository. Go to the [Beaver Notes repository](https://github.com/daniele-rolli/beaver-notes) on GitHub and click the "Fork" button in the top right corner. This will create a copy of the repository under your GitHub account.

#### Clone the Forked Repository

After forking the repository, you need to clone it to your local machine. Open a terminal or command prompt on your computer and run the following command:

```bash
git clone https://github.com/your-username/beaver-notes.git
```

{% hint style="info" %}
Replace "your-username" with your GitHub username.&#x20;
{% endhint %}

This command will download the repository to your computers.

#### Configure Upstream Remote

By default, your cloned repository is connected to your forked version on GitHub. To keep your fork in sync with the official repository and get the latest updates, you'll need to configure an "upstream" remote. In the terminal, navigate to the cloned repository's directory and run:

```bash
git remote add upstream https://github.com/daniele-rolli/beaver-notes.git
```

This sets the official Beaver Notes repository as the upstream remote.

#### Install Dependencies

Beaver Notes has certain dependencies required for development. Install them by running the following command in the terminal:

```bash
yarn install
```

This will install all the necessary dependencies specified in the project's package.json file.

You're now all set up to start contributing to Beaver Notes! The next steps involve building and testing the app, contributing code, and enhancing documentation. Join the community and be part of shaping the future of note-taking! 🚀

\
\


\
\
