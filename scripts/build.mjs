import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
await copyFile("index.html", "dist/index.html");
await copyFile("admin.html", "dist/admin.html");
await copyFile("signin.html", "dist/signin.html");

const siteKey = process.env.GAMESPHERE_TURNSTILE_SITE_KEY || "";
if (process.env.NODE_ENV === "production" && !siteKey) {
  throw new Error("Set GAMESPHERE_TURNSTILE_SITE_KEY before building for production.");
}
const authConnections = {
  google: process.env.GAMESPHERE_AUTH0_GOOGLE_CONNECTION || "google-oauth2",
  microsoft: process.env.GAMESPHERE_AUTH0_MICROSOFT_CONNECTION || "windowslive",
  yahoo: process.env.GAMESPHERE_AUTH0_YAHOO_CONNECTION || "yahoo",
  facebook: process.env.GAMESPHERE_AUTH0_FACEBOOK_CONNECTION || "facebook",
  apple: process.env.GAMESPHERE_AUTH0_APPLE_CONNECTION || "apple",
  epic: process.env.GAMESPHERE_AUTH0_EPIC_CONNECTION || "",
  gamesphere: process.env.GAMESPHERE_AUTH0_GAMESPHERE_CONNECTION || "Username-Password-Authentication"
};
const authDomain = process.env.GAMESPHERE_AUTH0_DOMAIN || "";
const authClientId = process.env.GAMESPHERE_AUTH0_CLIENT_ID || "";
const browserConfig = `window.GAMESPHERE_CONFIG = ${JSON.stringify({
  turnstileSiteKey: siteKey,
  auth0: { domain: authDomain, clientId: authClientId, connections: authConnections }
})};\n`;
await writeFile("gamesphere-config.js", browserConfig, "utf8");
await writeFile("dist/gamesphere-config.js", browserConfig, "utf8");
await build({
  entryPoints: ["scripts/local-game.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: "local-game.js"
});
await copyFile("local-game.js", "dist/local-game.js");
await build({
  entryPoints: ["scripts/local-game-library.js"],
  bundle: true,
  format: "iife",
  globalName: "GameSphereLocalLibrary",
  platform: "browser",
  target: ["es2020"],
  outfile: "local-game-library.js"
});
await copyFile("local-game-library.js", "dist/local-game-library.js");
await build({
  entryPoints: ["scripts/account.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: "account.js"
});
await copyFile("account.js", "dist/account.js");
await build({
  entryPoints: ["scripts/signin.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: "signin.js"
});
await copyFile("signin.js", "dist/signin.js");
console.log("Built GameSphere into dist/.");
