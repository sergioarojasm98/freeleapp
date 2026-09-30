# Changelog

All notable changes to Freeleapp are documented here. Versions follow [Semantic Versioning](https://semver.org/).

Freeleapp is based on **Leapp 0.26.1**. For the history before the fork, see the [Leapp changelog](https://github.com/Noovolari/leapp/blob/v0.26.1/CHANGELOG.md).

## Unreleased

### Features

- Freeleapp runs on Electron 44 (up from 22) and Node.js 24. The old Electron 22 is what made windows lag on macOS 26, and upcoming macOS versions flag it as outdated. Electron 44 needs **macOS 13 Ventura or later**; stay on 1.0.1 on macOS 12.
- Sign-in to AWS IAM Identity Center works behind corporate networks that inspect TLS. Freeleapp now also trusts the root certificates installed in the macOS keychain (for example the one a company's proxy adds), not only the ones bundled with Node.js.
- Each AWS IAM Identity Center role gets its own named profile, `<account>-<role>` (for example `payments-prod-AdministratorAccess`), so several roles can be active at the same time. You can still pick or type another profile. On first launch, roles that were on the `default` profile move to their own profile; roles with a profile you chose keep it.
- A named profile can only belong to one session. Choosing a profile that another session already uses shows which session has it, instead of silently stopping that session later. New sessions get `default` preselected only while no other session uses it.
- Settings → Profiles lists the profiles you manage: `default` and the ones you added. The profiles sessions have of their own (`<account>-<role>`, or the session name) are not listed; they are created with their session and deleted with it. `default` is now a profile like the others: it can be renamed or deleted, and added again by name. Deleting a profile moves its sessions to a profile of their own instead of `default`.
- **Tunnels**: SSM port forwarding that runs in the background. In View SSM Sessions, **Forward Port** on an instance saves a tunnel to a port on that instance, or through it to another host such as a database endpoint, and starts it without a terminal window. **Tunnels** in the sidebar lists them with their status and local address: start, stop, edit or delete them, copy `localhost:port`, or copy the equivalent `aws ssm start-session` command. A tunnel that drops reconnects with fresh credentials (up to three times), a busy local port is reported before starting, and a tunnel can start with its session. Tunnels stop when Freeleapp quits, and ones left by a crash are stopped on the next launch. They need the AWS CLI and the Session Manager plugin.
- **Copy Command** next to each instance in View SSM Sessions copies the `aws ssm start-session` command with the session's named profile, to paste in any terminal.
- The sidebar reads **Sessions**, **Pinned Sessions**, **Tunnels** and **Pinned Tunnels**. **Sessions** shows how many sessions are active, like **Tunnels** shows the running tunnels. Past 9 the badge reads *9+*; hover it for the exact number.
- Tunnels can be pinned from their menu and are then listed first and under **Pinned Tunnels**.
- In the Tunnels views the search box filters tunnels by name, session, profile, target or port. The session filters, which do not apply to tunnels, are hidden there.
- Saving, pinning or deleting a tunnel confirms it with a notification.
- Esc closes every dialog like its Cancel or close button: create and edit session, Settings, SSM, tunnels, confirmations and the rest. With a dropdown or menu open, Esc closes that first; with a confirmation on top of another dialog, it closes only the confirmation.
- View SSM Sessions opens on the region you used last for each session, else on the session's own region, and shows the instances it already loaded right away, with when they were loaded. The refresh button next to the region loads them from AWS again. The **Populate Region** setting, which left the region empty by default, is gone.
- **Default Local Port** in Settings → SSM decides what a tunnel with an empty Local Port uses: the remote port (as before), or the remote port unless something on your Mac already listens on it, and then a free port.
- The port forwarding form offers common remote ports in one click: PostgreSQL, MySQL, Redis, RabbitMQ and its management UI, SSH and RDP.
- Buttons look the same everywhere: blue with white text, with the same hover and pressed states, in both color themes. Filter chips turn blue while they filter something. Action buttons explain what they do on hover.

### Removed

- The **Local Workspace** entry at the top of the sidebar. It was the workspace switcher of Leapp Team, which Freeleapp does not have, so it did nothing.
- The plugin system, with its **Plugins** tab in Settings, the Plugins entry of the session menu and the `freeleapp://` links that installed plugins. Plugins were npm packages that ran with full access to your system and were no longer verified: the Leapp service that signed them is gone. SSM port forwarding, the most used plugin feature, is now built in. A leftover `~/.freeleapp/plugins` folder can be deleted.

### Bug Fixes

- If the IAM Identity Center portal URL cannot be reached (network or certificate error), syncing the integration fails with an error instead of waiting forever.
- The session list keeps a predictable order. **Order by Date** (on by default) now lists started sessions by start time and the rest by name; before, it left them in the order they were created. Ordering by a column header also survives starting or stopping a session, instead of jumping back to the default order.
- Starting or stopping a session from its row icon keeps that session selected. As the list re-ordered, the selection could land on another row.
- Deleting a profile or an IdP URL in Settings asks for confirmation on top of Settings instead of closing it. Profile and IdP URL rows keep their name and buttons on one line.
- Checked checkboxes use the app's blue instead of Material's pink.
- The status dot of a selected session stays visible while the pointer is over it.
- View SSM Sessions shows every instance by its EC2 Name tag, with its id, IP address and platform below. Instances launched together (for example by an Auto Scaling group) showed their id instead of their name, and stopped instances are no longer listed. The dialog is wider, so long names fit.

## 1.0.1 (2026-09-26)

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
