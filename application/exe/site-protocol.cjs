const fs = require("node:fs/promises");
const path = require("node:path");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function apiUnavailable() {
  return json({
    error: "Online publishing needs the public GameSphere website and backend to be deployed."
  }, 503);
}

function isInsideDirectory(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function createSiteProtocolHandler(siteDirectory) {
  const root = path.resolve(siteDirectory);
  return async request => {
    const url = new URL(request.url);
    if (url.hostname !== "app") {
      return new Response("Not found.", { status: 404 });
    }

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/site-config" && request.method === "GET") {
        try {
          const config = await fs.readFile(path.join(root, "desktop-site-config.json"));
          return new Response(config, {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/json; charset=utf-8"
            }
          });
        } catch (error) {
          console.error("Could not load the bundled GameSphere site settings:", error);
          return json({ error: "The bundled GameSphere site settings are unavailable." }, 500);
        }
      }
      if (url.pathname === "/api/games" && request.method === "GET") {
        return json({ games: [] });
      }
      if (url.pathname === "/api/games" && request.method === "POST") {
        return apiUnavailable();
      }
      return json({ error: "This API is unavailable in the bundled desktop app." }, 503);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed.", { status: 405 });
    }

    let relativePath;
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    } catch {
      return new Response("Invalid asset path.", { status: 400 });
    }
    if (!relativePath) relativePath = "index.html";

    const filePath = path.resolve(root, relativePath);
    if (!isInsideDirectory(root, filePath)) {
      return new Response("Invalid asset path.", { status: 400 });
    }

    try {
      const content = await fs.readFile(filePath);
      return new Response(request.method === "HEAD" ? null : content, {
        headers: {
          "Cache-Control": "no-cache",
          "Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"
        }
      });
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EISDIR") {
        return new Response("Not found.", { status: 404 });
      }
      console.error("Could not serve a bundled GameSphere asset:", error);
      return new Response("The bundled GameSphere asset could not be loaded.", { status: 500 });
    }
  };
}

module.exports = { createSiteProtocolHandler };
