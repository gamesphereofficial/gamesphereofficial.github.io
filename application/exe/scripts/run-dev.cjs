const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { prepareSite } = require("./prepare-site.cjs");

async function runApp() {
  const appDirectory = path.resolve(__dirname, "..");
  const sitePath = path.join(appDirectory, "site");
  try {
    await prepareSite();
    const electron = spawn(process.execPath, [
      path.join(appDirectory, "node_modules", "electron", "cli.js"),
      "."
    ], {
      cwd: appDirectory,
      stdio: "inherit"
    });
    const exitCode = await new Promise((resolve, reject) => {
      electron.once("error", reject);
      electron.once("exit", (code, signal) => {
        if (signal) {
          reject(new Error(`Electron exited due to ${signal}.`));
        } else {
          resolve(code ?? 1);
        }
      });
    });
    process.exitCode = exitCode;
  } finally {
    fs.rmSync(sitePath, { recursive: true, force: true });
  }
}

runApp().catch(error => {
  console.error("Could not run the GameSphere desktop app:", error);
  process.exitCode = 1;
});
