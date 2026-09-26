# Changelog

All notable changes to Freeleapp are documented here. Versions follow [Semantic Versioning](https://semver.org/).

Freeleapp is based on **Leapp 0.26.1**. For the history before the fork, see the [Leapp changelog](https://github.com/Noovolari/leapp/blob/v0.26.1/CHANGELOG.md).

## Unreleased

### Features

- Labels, buttons, tabs, tooltips, placeholders and short notifications use Title Case consistently (for example *Options Saved*, *Add a New Named Profile*, *Installed Plugins*), and names such as URL, ID, MFA and macOS are spelled the same everywhere. Full-sentence messages keep sentence case.
- Settings has a **Cancel** link next to **Done**. Cancel, Esc or a click outside the dialog close it without saving; if you changed something, Freeleapp first asks whether to discard the changes. A color theme you were previewing goes back to the previous one. Adding, editing or deleting IdP URLs, profiles and plugins still apply right away.

### Removed

- The **AWS Credential Method** setting and its *credential-process* option. It relied on the Leapp CLI, which Freeleapp does not ship, so sessions using it could not get credentials. Freeleapp always writes temporary credentials to `~/.aws/credentials`. A Leapp setup that used credential-process is switched over on first launch, and only the `credential_process = leapp session generate …` profiles Leapp added to `~/.aws/config` are removed.

### Bug Fixes

- Macs without the AWS Session Manager plugin no longer get an error at startup. Freeleapp checks the AWS CLI and the plugin when you open **View SSM Sessions** and links to the install steps if one is missing.
- **Open Issue** and **Request Feature** stay available when the AWS CLI or the Session Manager plugin is not installed.
- A selected session no longer shows a small start/stop button squeezed next to the provider icon. The button replaces the icon only while the pointer is over the row, as before.
- The region list in the SSM dialog is no longer cut off by the dialog's edge.
- **Pinned** clears a saved filter or search before showing the pinned sessions, like **All Sessions** does. Before, it showed only the pinned sessions that also matched the previous filter, which was often an empty list.
- The IdP URL, Named Profiles and Plugins lists in Settings use the full height of the window instead of a fixed 230 px box.

## 1.0.0 (2026-09-25)

First Freeleapp release, a maintained fork of Leapp for current macOS versions.

### Features

- New identity: Freeleapp name, cloud icon with a Liquid Glass version for macOS 26 and later, and a blue and graphite color palette.
- One edition with every feature: the Leapp Pro and Team screens, sign-in, plans and workspace sync are gone.
- AWS console links sign in directly, so several accounts stay open side by side with the console's native multi-session support.
- Region dropdowns list the four most used regions first under *Recently used*.
- Press Escape in the search bar to clear it.
- *Saved segments* are now **Saved Filters**, saved from a proper **Save Filter** button.
- Modals and the overlay sidebar dim the window behind them the same way, in both themes.
- Active sessions show a green status dot, and the actions button appears next to it instead of replacing it.
- The window stays resizable when the sidebar is hidden, works with window managers such as Rectangle, and adapts to narrow widths: the sidebar hides itself and the sidebar button shows it on top of the list.
- Double-clicking the top bar follows the macOS title bar setting (zoom, minimize or nothing).
- Documentation, updates, release notes and issue links point to Freeleapp.
- *What's new* shows the release notes of the installed version.
- Freeleapp keeps its data under its own names: `~/.freeleapp`, the `Freeleapp` keychain service, `~/Library/Logs/Freeleapp` and the `freeleapp://` scheme. A Leapp setup is copied over automatically on first launch; `~/.Leapp` is left as a backup.

### Bug fixes

- Refreshing sessions from `leapp-cli` now reloads the app; it never did because the request went through the disabled Team service.
- The SSM dialog stays inside the window and scrolls its instance list.
- Saved filters apply on the first click.
- Logging out of federated sessions finds the login data again after the app rename.

### Removed

- Usage analytics (PostHog) and the Angular CLI analytics.
- The multi-console browser extension and its local WebSocket server on port 8095; use the AWS console's multi-session instead.
- The Noovolari shutdown notice and Slack community links.
- Touch ID and require-password options, which only applied to the Team lock screen.
