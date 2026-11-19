import { unzipSync } from "fflate";
import { getAssetMimeType } from "../../scripts/asset-mime-types.js";

const MAX_ZIP_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 48 * 1024 * 1024;
const MAX_FILES = 750;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function safeArchivePath(name) {
  const normalized = name.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes(":") ||
    normalized.split("/").some(part => part === "." || part === ".." || part.includes("\0"))
  ) {
    throw new Error("The ZIP contains an unsafe file path.");
  }
  return normalized;
}

async function verifyTurnstile(request, env, token) {
  if (!token || token.length > 2048) {
    return false;
  }

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) form.set("remoteip", clientIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    throw new Error("Cloudflare upload verification could not be reached.");
  }
  const result = await response.json();
  return result.success === true;
}

async function readZipBody(request) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ZIP_BYTES) {
        await reader.cancel();
        throw new Error("The ZIP exceeds the 10 MB upload limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const zip = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    zip.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return zip;
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Cross-origin uploads are not allowed." }, 403);
  }
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/zip") {
    return json({ error: "Upload a ZIP file with the application/zip content type." }, 415);
  }

  const gameOrigin = env.GAME_ORIGIN;
  let parsedGameOrigin;
  try {
    parsedGameOrigin = new URL(gameOrigin);
  } catch {
    return json({ error: "The isolated game-host origin is not configured." }, 503);
  }
  if (parsedGameOrigin.protocol !== "https:" || parsedGameOrigin.origin === new URL(request.url).origin) {
    return json({ error: "Configure the game host on its own HTTPS origin." }, 503);
  }
  if (!env.TURNSTILE_SECRET_KEY) {
    return json({ error: "The upload verification secret is not configured." }, 503);
  }
  if (!env.GAMES_BUCKET) {
    return json({ error: "Game storage is not configured." }, 503);
  }

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ZIP_BYTES) {
    return json({ error: "The ZIP exceeds the 10 MB upload limit." }, 413);
  }

  try {
    let verified;
    try {
      verified = await verifyTurnstile(request, env, request.headers.get("X-Turnstile-Token"));
    } catch (error) {
      console.error("Turnstile verification request failed:", error);
      return json({ error: "Cloudflare upload verification is temporarily unavailable." }, 502);
    }
    if (!verified) {
      return json({ error: "Upload verification failed. Complete the challenge and try again." }, 403);
    }

    const zip = await readZipBody(request);
    if (zip.byteLength === 0 || zip.byteLength > MAX_ZIP_BYTES) {
      return json({ error: "The ZIP must be between 1 byte and 10 MB." }, 413);
    }

    let fileCount = 0;
    let expandedBytes = 0;
    const files = unzipSync(zip, {
      filter(file) {
        safeArchivePath(file.name);
        if (!file.name.endsWith("/") && !file.name.endsWith("\\")) {
          fileCount += 1;
          const fileSize = Number(file.originalSize);
          if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
            throw new Error("The ZIP contains an invalid file entry.");
          }
          const unixFileType = (Number(file.attrs) >>> 16) & 0xf000;
          if (unixFileType === 0xa000) {
            throw new Error("The ZIP contains a symbolic link, which is not supported.");
          }
          expandedBytes += fileSize;
          if (fileCount > MAX_FILES) {
            throw new Error(`The ZIP contains more than ${MAX_FILES} files.`);
          }
          if (expandedBytes > MAX_EXPANDED_BYTES) {
            throw new Error("The extracted game exceeds the 48 MB limit.");
          }
        }
        return true;
      }
    });

    const fileEntries = Object.entries(files)
      .map(([name, bytes]) => [safeArchivePath(name), bytes])
      .filter(([name]) => !name.endsWith("/"));
    if (!fileEntries.length) {
      return json({ error: "The ZIP does not contain any files." }, 400);
    }

    const indexEntry = fileEntries
      .filter(([name]) => /(^|\/)index\.html?$/i.test(name))
      .sort(([a], [b]) => a.length - b.length)[0];
    if (!indexEntry) {
      return json({ error: "No index.html was found in the uploaded ZIP." }, 400);
    }

    const gameId = `${Date.now().toString(16).padStart(13, "0")}${crypto.randomUUID().replaceAll("-", "").slice(0, 19)}`;
    const gameName = decodeURIComponent(request.headers.get("X-Game-Name") || "Published game")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 80) || "Published game";
    const encodedIndexPath = indexEntry[0]
      .split("/")
      .map(segment => encodeURIComponent(segment))
      .join("/");
    const playUrl = `${parsedGameOrigin.origin}/${gameId}/${encodedIndexPath}`;
    const writtenKeys = [];
    try {
      for (const [path, bytes] of fileEntries) {
        const key = `games/${gameId}/${path}`;
        await env.GAMES_BUCKET.put(key, bytes, {
          httpMetadata: { contentType: getAssetMimeType(path, bytes) },
          customMetadata: { gameId, gameName, gameEntry: path === indexEntry[0] ? "true" : "false" }
        });
        writtenKeys.push(key);
      }
      const publishedAt = new Date().toISOString();
      const catalogueKey = `catalog/${String(Number.MAX_SAFE_INTEGER - Date.now()).padStart(16, "0")}-${gameId}.json`;
      await env.GAMES_BUCKET.put(catalogueKey, "{}", {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { gameId, name: gameName, playUrl, publishedAt, visibility: "public" }
      });
      writtenKeys.push(catalogueKey);
    } catch (error) {
      if (writtenKeys.length) {
        try {
          await env.GAMES_BUCKET.delete(writtenKeys);
        } catch (cleanupError) {
          console.error("Could not clean up a failed game upload:", cleanupError);
        }
      }
      console.error("Could not save the uploaded game in R2:", error);
      return json({ error: "Game storage failed. Please try again later." }, 502);
    }

    return json({
      id: gameId,
      name: gameName,
      playUrl
    }, 201);
  } catch (error) {
    console.error("Game ZIP publishing failed:", error);
    return json({ error: error instanceof Error ? error.message : "The game ZIP could not be published." }, 400);
  }
}

export async function onRequestGet({ request, env }) {
  if (!env.GAMES_BUCKET) {
    return json({ error: "Game storage is not configured." }, 503);
  }

  try {
    const games = [];
    let cursor;
    do {
      const page = await env.GAMES_BUCKET.list({
        prefix: "catalog/",
        limit: 1000,
        ...(cursor ? { cursor } : {}),
        include: ["customMetadata"]
      });
      games.push(...page.objects
        .map(object => object.customMetadata)
        .filter(game => game?.gameId && game?.name && game?.playUrl &&
          (game.visibility === "public" || game.visibility === "my-games" || !game.visibility))
        .map(game => ({
          id: game.gameId,
          name: game.name,
          playUrl: game.playUrl,
          publishedAt: game.publishedAt
        })));
      cursor = page.truncated ? page.cursor : undefined;
      if (page.truncated && !cursor) throw new Error("Storage pagination returned no cursor.");
    } while (cursor);
    return json({ games });
  } catch (error) {
    console.error("Could not list published games:", error);
    return json({ error: "Published games could not be loaded." }, 500);
  }
}
