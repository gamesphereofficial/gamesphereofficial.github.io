import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const brfs = require("brfs");
const scratchRenderPlugin = {
  name: "scratch-render-webpack-loaders",
  setup(esbuild) {
    esbuild.onResolve({ filter: /^raw-loader!/ }, args => ({
      path: resolve(dirname(args.importer), args.path.slice("raw-loader!".length)),
      namespace: "scratch-render-raw"
    }));
    esbuild.onLoad({ filter: /.*/, namespace: "scratch-render-raw" }, async args => ({
      contents: `module.exports = ${JSON.stringify(await readFile(args.path, "utf8"))};`,
      loader: "js"
    }));
    esbuild.onResolve({ filter: /^!ify-loader!/ }, args => ({
      path: require.resolve(args.path.slice("!ify-loader!".length), { paths: [args.resolveDir] })
    }));
    esbuild.onLoad({ filter: /[/\\](?:linebreak|grapheme-breaker)[/\\]src[/\\][^/\\]+\.js$/ }, async args => {
      const source = await readFile(args.path, "utf8");
      const transformed = await new Promise((resolveTransform, rejectTransform) => {
        const transform = brfs(args.path);
        let output = "";
        transform.on("data", chunk => { output += chunk; });
        transform.on("error", rejectTransform);
        transform.on("end", () => resolveTransform(output));
        transform.end(source);
      });
      return { contents: `import { Buffer } from "buffer";\n${transformed}`, loader: "js" };
    });
  }
};

await mkdir("dist", { recursive: true });
await copyFile("index.html", "dist/index.html");
await copyFile("admin.html", "dist/admin.html");
await copyFile("signin.html", "dist/signin.html");
await copyFile("node_modules/lzma/src/lzma-min.js", "lzma-min.js");
await copyFile("node_modules/lzma/src/lzma-min.js", "dist/lzma-min.js");
await copyFile("node_modules/lzma/src/lzma_worker-min.js", "lzma_worker-min.js");
await copyFile("node_modules/lzma/src/lzma_worker-min.js", "dist/lzma_worker-min.js");

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
  romApiOrigin: process.env.GAMESPHERE_ROM_API_ORIGIN || "https://gamesphere.pages.dev",
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
  entryPoints: ["scripts/makecode-player.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: "makecode-player.js"
});
await copyFile("makecode-player.js", "dist/makecode-player.js");
await build({
  entryPoints: ["scripts/scratch-player.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: "scratch-player.js"
});
await copyFile("scratch-player.js", "dist/scratch-player.js");
await build({
  entryPoints: ["scripts/retro-player.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: "retro-player.js"
});
await copyFile("retro-player.js", "dist/retro-player.js");
await build({
  entryPoints: ["scripts/scratch-runtime.js"],
  bundle: true,
  format: "iife",
  globalName: "GameSphereScratchRuntime",
  platform: "browser",
  plugins: [scratchRenderPlugin],
  target: ["es2020"],
  outfile: "scratch-runtime.js"
});
await copyFile("scratch-runtime.js", "dist/scratch-runtime.js");
await copyFile("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
const scratchStorageWorkerDir = "node_modules/scratch-storage/dist/web/chunks";
const scratchStorageWorkers = (await readdir(scratchStorageWorkerDir))
  .filter(file => /^fetch-worker\..+\.js$/.test(file));
if (!scratchStorageWorkers.length) {
  throw new Error(`No Scratch asset fetch workers found in ${scratchStorageWorkerDir}.`);
}
await mkdir("chunks", { recursive: true });
await mkdir("dist/chunks", { recursive: true });
for (const worker of scratchStorageWorkers) {
  await copyFile(`${scratchStorageWorkerDir}/${worker}`, `chunks/${worker}`);
  await copyFile(`${scratchStorageWorkerDir}/${worker}`, `dist/chunks/${worker}`);
}
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
