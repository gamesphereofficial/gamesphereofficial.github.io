const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { createSiteProtocolHandler } = require("../site-protocol.cjs");

const temporaryDirectory = path.join(os.tmpdir(), `gamesphere-site-${process.pid}`);
let handler;

test("sets up a minimal bundled website fixture", async () => {
  await fs.mkdir(temporaryDirectory, { recursive: true });
  await fs.writeFile(path.join(temporaryDirectory, "index.html"), "<main>GameSphere</main>");
  await fs.writeFile(path.join(temporaryDirectory, "desktop-site-config.json"), JSON.stringify({
    colors: { background: "#090b16" }
  }));
  handler = createSiteProtocolHandler(temporaryDirectory);
});

test("serves bundled website content and site colors", async () => {
  const page = await handler(new Request("gamesphere://app/index.html"));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /GameSphere/);

  const settings = await handler(new Request("gamesphere://app/api/site-config"));
  assert.equal(settings.status, 200);
  assert.equal((await settings.json()).colors.background, "#090b16");
});

test("returns an empty game list and explains publishing needs the hosted backend", async () => {
  const list = await handler(new Request("gamesphere://app/api/games"));
  assert.deepEqual(await list.json(), { games: [] });

  const publish = await handler(new Request("gamesphere://app/api/games", { method: "POST" }));
  assert.equal(publish.status, 503);
  assert.match((await publish.json()).error, /public GameSphere website and backend/);
});

test("rejects unknown hosts, unsupported methods, and missing assets", async () => {
  assert.equal((await handler(new Request("gamesphere://other/index.html"))).status, 404);
  assert.equal((await handler(new Request("gamesphere://app/index.html", { method: "PUT" }))).status, 405);
  assert.equal((await handler(new Request("gamesphere://app/missing.js"))).status, 404);
});

after(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});
