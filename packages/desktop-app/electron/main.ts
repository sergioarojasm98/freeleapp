import { contextMenu } from "./context-menu";
import { migrateLegacyData } from "./legacy-data-migration";
import * as path from "path";
import { environment } from "../src/environments/environment";

const { app, BrowserWindow, ipcMain, Tray, Menu, systemPreferences } = require("electron");
const electronLocalshortcut = require('electron-localshortcut');
const { autoUpdater } = require("electron-updater");

const url = require("url");
const ipc = ipcMain;

const remote = require("@electron/remote/main");
remote.initialize();

contextMenu({
  showInspectElement: false,
  showLookUpSelection: false,
  showSearchWithGoogle: false
});

app.disableHardwareAcceleration();

if (process.platform === "linux") {
  app.commandLine.appendSwitch("disable-software-rasterizer");
  app.commandLine.appendSwitch("in-process-gpu");
}


// Main Window configuration: set here the options to make it works with your app
// Electron is the application wrapper so NOT log is prompted when we build an
// application, we need to log to a file instead
const windowDefaultConfig = {
  dir: path.join(__dirname, `/../../../dist/leapp-client`),
  browserWindow: {
    width: 1200,
    height: 680,
    title: ``,
    icon: path.join(__dirname, `assets/images/Leapp.png`),
    resizable: true,
    webPreferences: {
      devTools: !environment.production,
      contextIsolation: false,
      nodeIntegration: true
    },
  },
};
if (process.platform !== "win32") {
  windowDefaultConfig.browserWindow["titleBarStyle"] = "hidden";
  windowDefaultConfig.browserWindow["titleBarOverlay"] = true;
} else {
  windowDefaultConfig.browserWindow["titleBarStyle"] = "hidden";
  Menu.setApplicationMenu(null);
}

if (process.platform === "darwin") {
  windowDefaultConfig.browserWindow["trafficLightPosition"] = { x: 20, y: 20 };
}

// Set by the Update button: the window closes for real (sessions are stopped first) and the updater quits the app
let installingUpdate = false;

const buildAutoUpdater = (win: any): void => {
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  // Downloads start below, depending on the Automatically Download Updates setting sent by the renderer
  autoUpdater.autoDownload = false;

  // Force dev update config for testing auto-updater in development
  if (!environment.production) {
    autoUpdater.forceDevUpdateConfig = true;
    console.log("[AUTO-UPDATER] Forcing dev update config for testing");
  }

  const minutes = 10;

  const data = {
    provider: "github",
    owner: "sergioarojasm98",
    repo: "freeleapp",
  };
  autoUpdater.setFeedURL(data);

  let autoDownload: boolean | undefined;
  let availableVersion: string | undefined;
  let downloadedVersion: string | undefined;
  let downloading = false;

  const checkForUpdates = (label: string) => {
    autoUpdater.checkForUpdates().then((_) => {
      console.log(`[AUTO-UPDATER] ${label} update check completed`);
    }).catch((error) => {
      console.log(`[AUTO-UPDATER] ${label} update check failed:`, error);
    });
  };

  const downloadUpdate = () => {
    if (downloading || !availableVersion || availableVersion === downloadedVersion) {
      return;
    }
    downloading = true;
    autoUpdater.downloadUpdate().catch((error) => {
      console.log("[AUTO-UPDATER] Download failed:", error);
    }).finally(() => {
      downloading = false;
    });
  };

  // Sent once the workspace is loaded and again when the setting changes; the first one starts the checks
  ipc.on("UPDATER_SETTINGS", (_, settings) => {
    const firstSettings = autoDownload === undefined;
    autoDownload = !!settings?.autoDownload;
    if (firstSettings) {
      checkForUpdates("Initial");
      setInterval(() => checkForUpdates("Periodic"), 1000 * 60 * minutes);
    } else if (autoDownload) {
      downloadUpdate();
    }
  });

  ipc.on("INSTALL_UPDATE", () => {
    if (!downloadedVersion) {
      return;
    }
    console.log("[AUTO-UPDATER] Installing", downloadedVersion);
    installingUpdate = true;
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[AUTO-UPDATER] Update available:", info);
    availableVersion = info.version;
    if (autoDownload) {
      downloadUpdate();
    } else {
      win.webContents.send("UPDATE_AVAILABLE", info);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[AUTO-UPDATER] Update downloaded:", info.version);
    if (info.version !== downloadedVersion) {
      downloadedVersion = info.version;
      win.webContents.send("UPDATE_DOWNLOADED", { version: info.version });
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("[AUTO-UPDATER] Update not available:", info);
  });

  autoUpdater.on("error", (err) => {
    console.log("[AUTO-UPDATER] Error:", err);
  });

  autoUpdater.on("checking-for-update", () => {
    console.log("[AUTO-UPDATER] Checking for updates...");
  });
};

// Generate the main Electron window
const generateMainWindow = () => {
  if (process.platform === "linux" && ["Pantheon", "Unity:Unity7"].indexOf(process.env.XDG_CURRENT_DESKTOP) !== -1) {
    process.env.XDG_CURRENT_DESKTOP = "Unity";
  }

  let win;
  let forceQuit = false;
  let taskbar;
  let trayOpen = false;
  let trayWin;

  const createWindow = () => {
    // Generate the App Window
    win = new BrowserWindow({ ...windowDefaultConfig.browserWindow });
    win.setMenuBarVisibility(false); // Hide Window Menu to make it compliant with MacOSX
    win.removeMenu(); // Remove Window Menu inside App, to make it compliant with Linux
    win.setMenu(null);
    win.loadURL(url.format({ pathname: windowDefaultConfig.dir + "/index.html", protocol: "file:", slashes: true }));
    win.center();

    // Small enough for window managers such as Rectangle (halves, thirds); the layout adapts below 900px
    win.setMinimumSize(560, 480);

    // Open the dev tools only if not in production
    if (!environment.production) {
      // Open web tools for diagnostics
      win.webContents.once("dom-ready", () => {});
    }

    win.on("close", (event) => {
      event.preventDefault();
      if (!forceQuit && !installingUpdate) {
        win.hide();
      } else {
        win.webContents.send("app-close");
      }
    });

    // The hidden title bar is drawn by the app, so double-clicks are forwarded from the renderer and
    // handled like the native one, following System Settings > Desktop & Dock > "Double-click a window's title bar"
    ipc.on("title-bar-double-click", (evt) => {
      if (BrowserWindow.fromWebContents(evt.sender)?.id !== win.id) {
        return;
      }
      const action = systemPreferences.getUserDefault("AppleActionOnDoubleClick", "string");
      if (action === "Minimize" || (!action && systemPreferences.getUserDefault("AppleMiniaturizeOnDoubleClick", "boolean"))) {
        win.minimize();
      } else if (action !== "None") {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      }
    });

    ipc.on("closed", () => {
      win.destroy();
      if (installingUpdate) {
        // quitAndInstall continues once every window is closed; quit anyway if it never does
        setTimeout(() => app.quit(), 15000);
        return;
      }
      app.quit();
    });

    app.on("browser-window-focus", () => {
      electronLocalshortcut.register(win, ['CommandOrControl+R', 'CommandOrControl+Shift+R', 'F5'], () => {});
    });

    app.on("browser-window-focus", () => {
      electronLocalshortcut.register(win, ['CommandOrControl+A'], () => {
        win.webContents.send("select-all");
      });
    });

    app.on("browser-window-blur", () => {
      electronLocalshortcut.unregisterAll(win);
    });

    remote.enable(win.webContents);
  };

  const createTrayWindow = () => {
    // Generate the App Window
    const opts = { ...windowDefaultConfig.browserWindow, frame: false };
    opts["titleBarStyle"] = "CustomOnHover";
    opts["titleBarOverlay"] = true;
    opts["minimizable"] = false;
    opts["maximizable"] = false;
    opts["closable"] = false;

    trayWin = new BrowserWindow(opts);
    trayWin.setMenuBarVisibility(false); // Hide Window Menu to make it compliant with MacOSX
    trayWin.removeMenu(); // Remove Window Menu inside App, to make it compliant with Linux
    trayWin.setMenu(null);
    trayWin.loadURL(url.format({ pathname: windowDefaultConfig.dir + "/index.html", protocol: "file:", slashes: true }));

    const taskbarWidth = 362;
    const taskbarHeight = 480;

    // Set position of taskbar
    // Need to be modified to accommodate for various scenarios
    trayWin.setPosition(taskbar.getBounds().x - taskbarWidth + taskbar.getBounds().width, taskbar.getBounds().y + taskbar.getBounds().height);

    // Set new minimum windows for opened tool.
    trayWin.setMinimumSize(taskbarWidth, taskbarHeight);
    trayWin.setSize(taskbarWidth, taskbarHeight);

    // Open the dev tools only if not in production
    if (!environment.production) {
      // Open web tools for diagnostics
      trayWin.webContents.once("dom-ready", () => {});
    }

    remote.enable(trayWin.webContents);
  };

  const createTray = () => {
    if (!taskbar) {
      taskbar = new Tray(windowDefaultConfig.dir + `/assets/images/LeappTemplate.png`);
      taskbar.setToolTip("Freeleapp");
      taskbar.on("click", () => {
        trayOpen = !trayOpen;
        if (trayOpen) {
          // open
          createTrayWindow();
        } else {
          // close
          if (trayWin) {
            trayWin.setClosable(true);
            trayWin.close();
            trayWin = null;
          }
        }
      });
    }
  };

  app.on("activate", () => {
    if (win === undefined) {
      createWindow();
      require("electron-disable-file-drop");
    } else {
      win.show();
    }
  });

  app.on("before-quit", () => {
    forceQuit = true;
  });

  app.on("ready", () => {
    // Must run before the window loads: the renderer reads the configuration on startup
    try {
      console.log("[MIGRATION]", migrateLegacyData().reason);
    } catch (err) {
      console.log("[MIGRATION] Could not copy ~/.Leapp to ~/.freeleapp:", err);
    }
    createWindow();
    // createTray();
    buildAutoUpdater(win);

  });

  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      // Someone tried to run a second instance, we should focus our window.
      if (win) {
        if (win.isMinimized()) {
          win.restore();
        }
        win.show();
        win.focus();
      }
    });
  }
  if (process.platform === "win32") {
    app.setAppUserModelId("io.github.sergioarojasm98.freeleapp");
  }
};
// =============================== //
// Start the real application HERE //
// =============================== //
generateMainWindow();
