---
title: Get started
nav: Get started
description: Install Vicu on Windows, macOS, Linux, Android or iPhone, connect it to your Vikunja server, choose your Inbox and add your first tasks.
lead: Install Vicu, sign in to your Vikunja server, pick an Inbox and add your first tasks. It takes a few minutes.
---

## In short

- **Vicu needs a Vikunja server.** It has no server or account of its own. Use your own server or Vikunja Cloud, version 2.4.0 or newer.
- **Install the app** for your device, open it and enter your server address.
- **Sign in** with a username and password, single sign-on, or an API token.
- **Choose your Inbox**, the project where new tasks land. It syncs, so your other devices use the same one.
- **Add a task** with the **+** button or <kbd>Ctrl</kbd>+<kbd>N</kbd> (<kbd>Cmd</kbd> on a Mac), then look at **Today**.

## What you need first

Vicu shows and edits the tasks on a [Vikunja](https://vikunja.io/) server. Before you install, have these ready:

- The address of your server, for example `https://app.vikunja.cloud`.
- A way to sign in: a username and password, a single sign-on account, or an API token.

Vicu collects nothing. Your tasks go to your server and nowhere else. Everything else you turn on, such as the assistant or a calendar, is optional.

## Install Vicu

### Windows {desktop}

Download the installer from the [latest release](https://github.com/rendyhd/Vicu/releases/latest) and run it. It works on Windows 10 and 11 (x64).

The installer is not code-signed, so Windows SmartScreen may stop it. Choose **More info**, then **Run anyway**.

### macOS {desktop}

1. Download the `.dmg` from the [latest release](https://github.com/rendyhd/Vicu/releases/latest). It needs macOS 13 or newer on an Apple silicon Mac.
2. Open it and drag **Vicu** into **Applications**.

### Linux {desktop}

Vicu comes as an AppImage for x64 and arm64.

1. Download the file from the [latest release](https://github.com/rendyhd/Vicu/releases/latest).
2. Make it runnable with `chmod +x Vicu-*.AppImage`.
3. Run it.

The AppImage needs no extra libraries. It also carries update information, so tools such as AppImageUpdate or Gear Lever can update it.

> [!NOTE]
> On Wayland, accept the GlobalShortcuts dialog if one appears. If the global shortcuts still do not work, **Settings, Quick Entry / View** shows commands you can bind in your desktop's keyboard settings. On GNOME, the tray icon needs the AppIndicator and KStatusNotifierItem Support extension.

### Android {android}

Vicu for Android needs Android 8 or newer. Get it from Google Play as a beta, through Obtainium, or as an APK from the [mobile releases page](https://github.com/rendyhd/Vicu-Mobile/releases/latest). The Play build and the APK are the same signed app. The [Android download section](https://github.com/rendyhd/Vicu-Mobile#download) has the current steps for joining the beta.

### iPhone and iPad {ios}

Vicu needs iOS or iPadOS 17 or newer. It is a public beta on [TestFlight](https://testflight.apple.com/join/c6wuvXrH). Install TestFlight first if you do not have it, then open the link on your device.

## Connect to your server

:::steps
1. Open Vicu. On the desktop, the welcome screen asks for your **Server URL**. Enter it and choose **Continue**.
2. Pick how to sign in (see below).
3. Choose your Inbox project.
:::

Vicu checks the server first and shows only the sign-in methods it offers.

### Sign in with a username and password

Choose **Sign in with username & password**. Enter your **Username or Email** and **Password**. If you use two-factor authentication, Vicu then asks for the 6-digit code from your authenticator app.

### Sign in with single sign-on

If your server has single sign-on, you see a **Sign in with** button named for your provider. Vicu opens its own sign-in window, and you sign in there as you would on the web. Vicu needs nothing set up at the provider for this.

### Sign in with an API token

Choose **Use API Token instead** and paste a token from Vikunja. The setup screen has an info button that lists the permissions the token needs. A token that lacks a permission can sign in but fails later on comments, assignees or sharing; Vicu then tells you which permission is missing. A mistyped token no longer signs you out on the phone.

### When your provider asks for a passkey {desktop}

Some providers, such as Pocket ID, sign you in with a passkey. A passkey cannot complete inside Vicu's own sign-in window on macOS and Linux. When Vicu sees the request, it closes the window and offers **Sign in through your browser**. You can also choose **Uses a passkey? Sign in through your browser** yourself.

The browser sign-in needs one setting at your provider, once:

1. Copy the redirect address Vicu shows with the **Copy** button. On the desktop it is `http://127.0.0.1:47823/vicu/oidc-callback`.
2. Add it as a redirect (callback) URL to the Vikunja client at your identity provider.
3. Choose **Sign in through your browser** again and finish in your browser.

Vicu remembers which way you signed in and uses the same way when it asks you to sign in again. On Windows you do not need this, because Windows Hello handles passkeys.

### On a phone {phone}

The phone apps use the same methods. The setup remembers the server address, and **Back** steps through the screens. Tokens and passwords stay hidden behind a show toggle, and an `http://` address outside your own network gets a warning. On iPhone the single sign-on page opens in an in-app web view, which Google and some providers refuse. If that happens, use **Sign in through your browser**, a password or an API token. The browser redirect address on phones is `com.rendyhd.vicu:/oidc-callback`.

After setup, the phone asks to send notifications and explains why.

## Choose your Inbox

The Inbox is the project where new tasks land before you sort them. The last step of setup asks you to choose it.

- If another device already chose an Inbox, Vicu suggests that one.
- Otherwise Vicu suggests your server's default project, or a project named Inbox.
- You can change it later in **Settings, Projects**. A project cannot be put inside the Inbox.

The Inbox choice syncs to all your devices.

## Add your first tasks

1. Press the **+** button, or <kbd>Ctrl</kbd>+<kbd>N</kbd> on the desktop. On the phone, tap **+**.
2. Type `Call the dentist tomorrow 3pm`.
3. Press <kbd>Enter</kbd>.

Vicu reads the date and time from the words and shows them as chips. See [Quick add](guide:quick-add) for everything it understands. Then open **Today** to see what is due. When you finish a task, tick its checkbox; Vicu keeps it on screen for a few seconds and offers **Undo**.

## Switching account or server

Signing in as a different user, or on a different server, clears the previous account's custom lists, Inbox choice and synced settings from the device. Device settings such as the theme and shortcuts stay. If something has not reached the server yet, Vicu asks before signing you out.

## Where to go next

- Read [How Vicu is organized](guide:basics) for the big picture.
- Learn the ways to [add tasks](guide:capture).
- On the desktop, turn on Quick Entry in **Settings, Quick Entry / View** to add tasks from any app.
- Keep the guide handy: the [FAQ](guide:faq) covers sign-in and sync problems.

## Related

- [How Vicu is organized](guide:basics)
- [Add tasks](guide:capture)
- [Quick add](guide:quick-add)
- [Sync and offline](guide:sync)
- [Troubleshooting and FAQ](guide:faq)
