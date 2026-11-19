const MAX_ROM_BYTES = 96 * 1024 * 1024;
const GAME_ID_PATTERN = /^[a-f0-9]{32}$/;
const SYSTEMS = Object.freeze({
  n64: [".n64", ".v64", ".z64"],
  ps1: [".pbp"],
  psp: [".pbp"],
  nes: [".nes"],
  gba: [".gba"],
  gbc: [".gbc"],
  gb: [".gb"],
  snes: [".smc", ".sfc"],
  arcade: [".zip"],
  "bin-cue": [".zip"]
});

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin || origin === env.SITE_ORIGIN;
}

function json(body, status = 200, request, env) {
  const headers = { "Cache-Control": "no-store" };
  const origin = request?.headers.get("Origin");
  if (origin && isAllowedOrigin(request, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return Response.json(body, { status, headers });
}

function getUploadMetadata(request) {
  const system = request.headers.get("X-ROM-System");
  const allowedExtensions = SYSTEMS[system];
  if (!allowedExtensions) throw new Error("Choose a supported game system.");

  let fileName;
  try {
    fileName = decodeURIComponent(request.headers.get("X-ROM-Filename") || "");
  } catch {
    throw new Error("The ROM filename is invalid.");
  }
  fileName = fileName.replace(/[\u0000-\u001f\u007f/\\]/g, "").trim().slice(0, 120);
  if (!fileName || fileName === "." || fileName === ".." ||
      !allowedExtensions.some(extension => fileName.toLowerCase().endsWith(extension))) {
    throw new Error(`The filename is not valid for ${system}.`);
  }
  if ((system === "arcade" || system === "bin-cue") && !fileName.toLowerCase().endsWith(".zip")) {
    throw new Error(`${system === "arcade" ? "Arcade ROMs" : "BIN+CUE bundles"} must be uploaded as ZIP files.`);
  }

  let title;
  try {
    title = decodeURIComponent(request.headers.get("X-ROM-Name") || "");
  } catch {
    throw new Error("The game title is invalid.");
  }
  title = title.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "Retro game";
  return { system, fileName, title };
}

async function verifyTurnstile(request, env, token) {
  if (!token || token.length > 2048) return false;
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) form.set("remoteip", clientIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  if (!response.ok) throw new Error("Cloudflare upload verification could not be reached.");
  const result = await response.json();
  return result.success === true;
}

async function readPrefixAndStream(request, contentLength, requireZip) {
  if (!request.body) throw new Error("The ROM upload is empty.");
  const reader = request.body.getReader();
  const initialChunks = [];
  let initialBytes = 0;
  while (initialBytes < (requireZip ? 4 : 1)) {
    const { done, value } = await reader.read();
    if (done) break;
    initialChunks.push(value);
    initialBytes += value.byteLength;
    if (initialBytes > MAX_ROM_BYTES || initialBytes > contentLength) {
      await reader.cancel();
      throw new Error("The ROM exceeds the 96 MB upload limit.");
    }
  }

  const prefix = new Uint8Array(Math.min(initialBytes, 4));
  let prefixOffset = 0;
  for (const chunk of initialChunks) {
    const length = Math.min(chunk.byteLength, prefix.byteLength - prefixOffset);
    if (length <= 0) break;
    prefix.set(chunk.subarray(0, length), prefixOffset);
    prefixOffset += length;
  }
  if (initialBytes === 0 || (requireZip &&
      !(prefix[0] === 0x50 && prefix[1] === 0x4b &&
        ((prefix[2] === 0x03 && prefix[3] === 0x04) ||
         (prefix[2] === 0x05 && prefix[3] === 0x06) ||
         (prefix[2] === 0x07 && prefix[3] === 0x08))))) {
    await reader.cancel();
    throw new Error("The uploaded game bundle is not a valid ZIP file.");
  }

  let total = initialBytes;
  let initialIndex = 0;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        if (initialIndex < initialChunks.length) {
          controller.enqueue(initialChunks[initialIndex++]);
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          if (total !== contentLength) {
            controller.error(new Error("The ROM upload length did not match its Content-Length."));
            return;
          }
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > MAX_ROM_BYTES || total > contentLength) {
          await reader.cancel();
          controller.error(new Error("The ROM upload exceeded its declared size."));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    }
  });
  if (typeof FixedLengthStream === "undefined") return body;
  const fixedLength = new FixedLengthStream(contentLength);
  body.pipeTo(fixedLength.writable).catch(error => {
    console.error("Could not stream the ROM into its fixed-length upload:", error);
  });
  return fixedLength.readable;
}

export async function onRequestPost({ request, env }) {
  const respond = (body, status = 200) => json(body, status, request, env);
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(request, env)) {
    return respond({ error: "Cross-origin uploads are not allowed." }, 403);
  }
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/octet-stream") {
    return respond({ error: "Upload one supported ROM file or a ZIP bundle." }, 415);
  }
  if (request.headers.get("X-ROM-Rights-Confirmed") !== "true") {
    return respond({ error: "Confirm that you have the rights to publish this game file." }, 400);
  }
  if (!env.TURNSTILE_SECRET_KEY) return respond({ error: "Upload verification is not configured." }, 503);
  if (!env.GAMES_BUCKET) return respond({ error: "Game storage is not configured." }, 503);

  let gameOrigin;
  let siteOrigin;
  try {
    gameOrigin = new URL(env.GAME_ORIGIN);
    siteOrigin = new URL(env.SITE_ORIGIN || request.url);
  } catch {
    return respond({ error: "The game host or public site origin is not configured." }, 503);
  }
  if (gameOrigin.protocol !== "https:" || gameOrigin.origin === new URL(request.url).origin) {
    return respond({ error: "Configure the game host on its own HTTPS origin." }, 503);
  }
  if (siteOrigin.protocol !== "https:") {
    return respond({ error: "Configure the public website on an HTTPS origin." }, 503);
  }

  const contentLength = Number(request.headers.get("Content-Length"));
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_ROM_BYTES) {
    return respond({ error: "Each ROM upload must be between 1 byte and 96 MB." }, 413);
  }

  let metadata;
  try {
    metadata = getUploadMetadata(request);
  } catch (error) {
    return respond({ error: error.message }, 400);
  }

  try {
    let verified;
    try {
      verified = await verifyTurnstile(request, env, request.headers.get("X-Turnstile-Token"));
    } catch (error) {
      console.error("Turnstile verification request failed:", error);
      return respond({ error: "Cloudflare upload verification is temporarily unavailable." }, 502);
    }
    if (!verified) return respond({ error: "Upload verification failed. Complete the challenge and try again." }, 403);

    const gameId = `${Date.now().toString(16).padStart(13, "0")}${crypto.randomUUID().replaceAll("-", "").slice(0, 19)}`;
    const assetKey = `roms/${gameId}/${metadata.fileName}`;
    const assetUrl = `${gameOrigin.origin}/roms/${gameId}/${encodeURIComponent(metadata.fileName)}`;
    const playUrl = new URL("/", siteOrigin);
    playUrl.searchParams.set("retroGame", gameId);
    const publishedAt = new Date().toISOString();
    const rom = {
      id: gameId,
      name: metadata.title,
      system: metadata.system,
      fileName: metadata.fileName,
      assetUrl,
      playUrl: playUrl.href,
      publishedAt
    };

    let storedAsset = false;
    let body;
    try {
      body = await readPrefixAndStream(
        request,
        contentLength,
        metadata.fileName.toLowerCase().endsWith(".zip")
      );
    } catch (error) {
      return respond({ error: error.message }, 400);
    }

    try {
      await env.GAMES_BUCKET.put(assetKey, body, {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "public, max-age=31536000, immutable"
        },
        customMetadata: {
          gameId,
          name: metadata.title,
          system: metadata.system,
          fileName: metadata.fileName
        }
      });
      storedAsset = true;
      await env.GAMES_BUCKET.put(`rom-catalog/${gameId}.json`, JSON.stringify(rom), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: {
          gameId,
          name: metadata.title,
          system: metadata.system,
          assetUrl,
          playUrl: playUrl.href,
          publishedAt
        }
      });
    } catch (error) {
      if (storedAsset) {
        try {
          await env.GAMES_BUCKET.delete(assetKey);
        } catch (cleanupError) {
          console.error("Could not clean up an incomplete ROM upload:", cleanupError);
        }
      }
      console.error("Could not save the uploaded ROM in R2:", error);
      return respond({ error: "The game could not be saved. Check the file and try again." }, 502);
    }

    return respond(rom, 201);
  } catch (error) {
    console.error("ROM publishing failed:", error);
    return respond({ error: "The game could not be published." }, 502);
  }
}

export async function onRequestOptions({ request, env }) {
  if (!isAllowedOrigin(request, env)) {
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const origin = request.headers.get("Origin") || new URL(request.url).origin;
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-ROM-System, X-ROM-Name, X-ROM-Filename, X-ROM-Rights-Confirmed, X-Turnstile-Token",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    }
  });
}

export async function onRequestGet({ request, env }) {
  const respond = (body, status = 200) => json(body, status, request, env);
  if (!isAllowedOrigin(request, env)) {
    return respond({ error: "Cross-origin access is not allowed." }, 403);
  }
  if (!env.GAMES_BUCKET) return respond({ error: "Game storage is not configured." }, 503);
  const id = new URL(request.url).searchParams.get("id");
  if (id !== null) {
    if (!GAME_ID_PATTERN.test(id)) return respond({ error: "The game ID is invalid." }, 400);
    try {
      const object = await env.GAMES_BUCKET.get(`rom-catalog/${id}.json`);
      if (!object) return respond({ error: "This retro game was not found." }, 404);
      return respond(await object.json());
    } catch (error) {
      console.error("Could not load a published ROM:", error);
      return respond({ error: "The retro game could not be loaded." }, 500);
    }
  }

  try {
    const roms = [];
    let cursor;
    do {
      const page = await env.GAMES_BUCKET.list({
        prefix: "rom-catalog/",
        limit: 1000,
        ...(cursor ? { cursor } : {}),
        include: ["customMetadata"]
      });
      roms.push(...page.objects
        .map(object => object.customMetadata)
        .filter(rom => rom?.gameId && rom?.name && rom?.system && rom?.assetUrl && rom?.playUrl)
        .map(rom => ({
          id: rom.gameId,
          name: rom.name,
          system: rom.system,
          assetUrl: rom.assetUrl,
          playUrl: rom.playUrl,
          publishedAt: rom.publishedAt
        })));
      cursor = page.truncated ? page.cursor : undefined;
      if (page.truncated && !cursor) throw new Error("Storage pagination returned no cursor.");
    } while (cursor);
    return respond({ roms: roms.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))) });
  } catch (error) {
    console.error("Could not list published retro games:", error);
    return respond({ error: "Published retro games could not be loaded." }, 500);
  }
}
