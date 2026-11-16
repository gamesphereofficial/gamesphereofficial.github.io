const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function prepareSite() {
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  const distPath = path.join(projectRoot, "dist");
  const sitePath = path.join(__dirname, "..", "site");
  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    throw new Error("The website build is missing. Run npm run build from the project root first.");
  }

  fs.rmSync(sitePath, { recursive: true, force: true });
  fs.cpSync(distPath, sitePath, { recursive: true, force: true });
  const { DEFAULT_SITE_CONFIG } = await import(pathToFileURL(
    path.join(projectRoot, "functions", "_utils", "site-config.js")
  ).href);
  fs.writeFileSync(
    path.join(sitePath, "desktop-site-config.json"),
    `${JSON.stringify(DEFAULT_SITE_CONFIG, null, 2)}\n`
  );
  console.log(`Bundled the GameSphere website from ${distPath}.`);
  return sitePath;
}

module.exports = { prepareSite };
