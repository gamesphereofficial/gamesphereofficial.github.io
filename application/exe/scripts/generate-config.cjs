const fs = require("node:fs");
const path = require("node:path");

const configPath = path.join(__dirname, "..", "app-config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const appUrl = process.env.GAMESPHERE_DESKTOP_URL || config.appUrl;
const auth0Domain = process.env.GAMESPHERE_AUTH0_DOMAIN || config.auth0Domain;

let parsedAppUrl;
try {
  parsedAppUrl = new URL(appUrl);
} catch {
  throw new Error("GAMESPHERE_DESKTOP_URL must be a valid HTTPS URL.");
}
if (parsedAppUrl.protocol === "gamesphere:") {
  if (parsedAppUrl.hostname !== "app") {
    throw new Error("The bundled GameSphere URL must use the gamesphere://app origin.");
  }
} else if (parsedAppUrl.protocol !== "https:") {
  throw new Error("GAMESPHERE_DESKTOP_URL must use HTTPS.");
}

if (auth0Domain && !/^[a-z0-9.-]+$/i.test(auth0Domain)) {
  throw new Error("GAMESPHERE_AUTH0_DOMAIN must be a hostname without a URL scheme.");
}

fs.writeFileSync(configPath, `${JSON.stringify({ appUrl: parsedAppUrl.href, auth0Domain }, null, 2)}\n`);
console.log(`Configured GameSphere desktop app for ${parsedAppUrl.protocol === "gamesphere:" ? "the bundled website" : parsedAppUrl.origin}.`);
