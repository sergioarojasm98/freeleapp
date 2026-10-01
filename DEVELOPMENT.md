# Development

Freeleapp is a monorepo with two packages:

| Package | Path | What it is |
|---------|------|------------|
| Core | `packages/core` | Domain logic: sessions, integrations, named profiles, credential files, workspace storage and migrations |
| Desktop app | `packages/desktop-app` | Electron main process (`electron/`) and the Angular 15 renderer (`src/`) that uses Core |

The renderer runs with Node.js integration: Core and the Angular services call Node modules (`fs`, `keytar`, `child_process`) directly, and a few Electron APIs through `@electron/remote`.

## Requirements

- Node.js 24, the version bundled with Electron 44 (see `.nvmrc`): `nvm use`
- Xcode 26 command line tools on macOS, to compile native modules and the Icon Composer icon
- For SSM sessions: the AWS CLI and the Session Manager plugin

## Setup

```bash
nvm use
npm install                                   # root: lint and commit tooling
cd packages/core && npm install && npm run build
cd ../desktop-app && npm install              # rebuilds keytar for Electron
```

The desktop app depends on the local Core through `file:../core`, and imports its compiled output, so rebuild Core (`npm run build` in `packages/core`) after changing it.

## Run

```bash
cd packages/desktop-app
npm run build-and-run-dev                     # development build, then Electron
```

A production build is `npx gushio gushio/target-build.js 'configuration production'`, followed by `npx electron .` to run it or `npx electron-builder build --mac dir --arm64 --publish never` to package it.

Workspace data lives in `~/.freeleapp`, logs in `~/Library/Logs/Freeleapp`. To try something without touching your own setup, start the app with another `HOME`.

## Tests and lint

```bash
cd packages/core && npx jest
cd packages/desktop-app && npm test -- --watch=false --browsers=ChromeHeadless
npx eslint <files>                            # from the repository root
```

## Linux notes

The app is only shipped for macOS, but it also runs on Linux for development and debugging:

- Headless Karma needs Chromium (`CHROME_BIN=/usr/bin/chromium`, browser `ChromeHeadlessCI`).
- keytar needs `libsecret-1-0` and a Secret Service (`gnome-keyring`, started through `dbus-run-session`).
- GCC cannot compile the Windows-only DPAPI addon against the Electron 44 headers: install with `npm install --ignore-scripts`, then `npx electron-rebuild -f -o keytar`.
- Under Xvfb, click with `xdotool` rather than through DevTools, which skips the window's hit-testing.
- `ELECTRON_DEBUG_DRAGGABLE_REGIONS=1` (unpackaged builds only) draws the title bar's draggable regions over the window and logs them.

## Workspace migrations

Changes to the stored workspace go through a numbered migration in `packages/core/src/services/retro-compatibility-service.ts`; bump `constants.workspaceLastVersion` with it.

## Commits and releases

See [CONTRIBUTING.md](CONTRIBUTING.md).
