# Changelog

All notable changes to Freeleapp are documented here. Versions follow [Semantic Versioning](https://semver.org/).

Freeleapp is based on **Leapp 0.26.1**. For the history before the fork, see the [Leapp changelog](https://github.com/Noovolari/leapp/blob/v0.26.1/CHANGELOG.md).

## 1.0.0 (unreleased)

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

### Bug fixes

- Refreshing sessions from `leapp-cli` now reloads the app; it never did because the request went through the disabled Team service.
- The SSM dialog stays inside the window and scrolls its instance list.
- Logging out of federated sessions finds the login data again after the app rename.

### Removed

- Usage analytics (PostHog) and the Angular CLI analytics.
- The multi-console browser extension and its local WebSocket server on port 8095; use the AWS console's multi-session instead.
- The Noovolari shutdown notice and Slack community links.
- Touch ID and require-password options, which only applied to the Team lock screen.
