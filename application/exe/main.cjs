const { app, BrowserWindow, protocol, shell } = require("electron");
const path = require("node:path");
const config = require("./app-config.json");
const { createSiteProtocolHandler } = require("./site-protocol.cjs");

protocol.registerSchemesAsPrivileged([{
  scheme: "gamesphere",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}]);

function parseAppUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("GameSphere app URL must be a valid HTTPS URL or the bundled gamesphere://app origin.");
  }
  if (parsed.protocol === "gamesphere:" && parsed.hostname === "app") {
    return parsed;
  }
  if (parsed.protocol !== "https:") {
    throw new Error("GameSphere app URL must use HTTPS or the bundled gamesphere://app origin.");
  }
  return parsed;
}

const appUrl = parseAppUrl(config.appUrl);
const auth0Domain = typeof config.auth0Domain === "string" ? config.auth0Domain.trim() : "";

function isTrustedNavigation(value) {
  let destination;
  try {
    destination = new URL(value);
  } catch {
    return false;
  }
  if (destination.protocol === "gamesphere:" && destination.hostname === "app") return true;
  if (destination.protocol !== "https:") return false;
  if (destination.origin === appUrl.origin) return true;
  if (auth0Domain && destination.hostname === auth0Domain) return true;

  return new Set([
    "accounts.google.com",
    "login.microsoftonline.com",
    "login.live.com",
    "login.yahoo.com",
    "www.facebook.com",
    "appleid.apple.com",
    "www.epicgames.com",
    "accounts.epicgames.com"
  ]).has(destination.hostname);
}

function openExternalHttps(value) {
  let destination;
  try {
    destination = new URL(value);
  } catch {
    return;
  }
  if (destination.protocol === "https:") {
    shell.openExternal(destination.href);
  }
}

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 360,
    minHeight: 560,
    title: "GameSphere",
    backgroundColor: "#090b16",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttps(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedNavigation(url)) {
      event.preventDefault();
      openExternalHttps(url);
    }
  });

  window.webContents.on("will-attach-webview", event => {
    event.preventDefault();
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12" || (input.control && input.shift && ["i", "j"].includes(input.key.toLowerCase()))) {
      event.preventDefault();
    }
  });

  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  await window.loadURL(appUrl.href);
}

app.whenReady().then(async () => {
  try {
    if (appUrl.protocol === "gamesphere:") {
      await protocol.handle("gamesphere", createSiteProtocolHandler(path.join(__dirname, "site")));
    }
    await createMainWindow();
  } catch (error) {
    console.error("GameSphere could not be opened:", error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
