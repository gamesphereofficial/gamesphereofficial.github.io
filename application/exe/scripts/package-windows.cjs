const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { prepareSite } = require("./prepare-site.cjs");

async function packageWindows() {
  const appDirectory = path.resolve(__dirname, "..");
  const sitePath = path.join(appDirectory, "site");

  try {
    await prepareSite();
    execFileSync(process.execPath, [
      path.join(appDirectory, "node_modules", "electron-builder", "cli.js"),
      "--win",
      "nsis",
      "--x64"
    ], {
      cwd: appDirectory,
      stdio: "inherit"
    });
  } finally {
    fs.rmSync(sitePath, { recursive: true, force: true });
    console.log("Removed temporary loose website files; the installer contains them inside the app package.");
  }
}

packageWindows().catch(error => {
  console.error("Could not build the GameSphere Windows installer:", error);
  process.exitCode = 1;
});
