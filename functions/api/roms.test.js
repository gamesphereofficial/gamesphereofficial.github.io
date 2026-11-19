import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequestOptions, onRequestPost } from "./roms.js";

function createBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      const bytes = value instanceof ReadableStream
        ? new Uint8Array(await new Response(value).arrayBuffer())
        : new TextEncoder().encode(value);
      objects.set(key, { bytes, options });
    },
    async delete(key) {
      objects.delete(key);
    }
  };
}

function createRequest({
  system = "nes",
  fileName = "game.nes",
  bytes = [1, 2, 3],
  rights = "true",
  url = "https://gamesphere.test/api/roms",
  origin = "https://gamesphere.test"
} = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Origin": origin,
      "X-ROM-System": system,
      "X-ROM-Filename": encodeURIComponent(fileName),
      "X-ROM-Name": encodeURIComponent("Homebrew game"),
      "X-ROM-Rights-Confirmed": rights,
      "X-Turnstile-Token": "valid-token"
    },
    body: new Uint8Array(bytes)
  });
}

function createEnv(bucket, siteOrigin) {
  return {
    TURNSTILE_SECRET_KEY: "test-secret",
    GAME_ORIGIN: "https://games-host.test",
    SITE_ORIGIN: siteOrigin,
    GAMES_BUCKET: bucket
  };
}

test("publishes additional ROMs without replacing existing public games", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true }));
  const bucket = createBucket();
  const first = await onRequestPost({ request: createRequest(), env: createEnv(bucket) });
  const second = await onRequestPost({
    request: createRequest({ system: "gba", fileName: "game.gba", bytes: [4, 5, 6] }),
    env: createEnv(bucket)
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal([...bucket.objects.keys()].filter(key => key.startsWith("roms/")).length, 2);
  assert.equal([...bucket.objects.keys()].filter(key => key.startsWith("rom-catalog/")).length, 2);
});

test("allows only the configured website to use the cross-origin publishing API", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true }));
  const bucket = createBucket();
  const env = createEnv(bucket, "https://gamesphereofficial.github.io");
  const response = await onRequestPost({
    request: createRequest({
      url: "https://gamesphere.pages.dev/api/roms",
      origin: "https://gamesphereofficial.github.io"
    }),
    env
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://gamesphereofficial.github.io");

  const preflight = await onRequestOptions({
    request: new Request("https://gamesphere.pages.dev/api/roms", {
      method: "OPTIONS",
      headers: {
        Origin: "https://gamesphereofficial.github.io",
        "Access-Control-Request-Method": "POST"
      }
    }),
    env
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://gamesphereofficial.github.io");
});

test("rejects cross-origin calls from unconfigured websites", async () => {
  const response = await onRequestPost({
    request: createRequest({
      url: "https://gamesphere.pages.dev/api/roms",
      origin: "https://untrusted.example"
    }),
    env: createEnv(createBucket(), "https://gamesphereofficial.github.io")
  });
  assert.equal(response.status, 403);
});

test("rejects a public ROM upload without the rights confirmation", async () => {
  const response = await onRequestPost({
    request: createRequest({ rights: "false" }),
    env: createEnv(createBucket())
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /rights/);
});

test("rejects a ZIP mislabeled as an arcade or BIN+CUE bundle", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true }));
  t.mock.method(console, "error", () => {});
  const bucket = createBucket();
  const response = await onRequestPost({
    request: createRequest({ system: "arcade", fileName: "game.zip" }),
    env: createEnv(bucket)
  });
  assert.equal(response.status, 400);
  assert.equal(bucket.objects.size, 0);
});

test("rejects file extensions that do not match the selected system", async () => {
  const response = await onRequestPost({
    request: createRequest({ system: "nes", fileName: "game.gba" }),
    env: createEnv(createBucket())
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /filename/);
});
