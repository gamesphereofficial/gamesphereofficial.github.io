import { createSaveBridge } from "./game-save-bridge.js";
import { maintenanceResponse } from "../functions/_utils/maintenance-page.js";
import { readSiteConfig } from "../functions/_utils/site-config.js";
import { getAssetMimeType } from "../scripts/asset-mime-types.js";

function responseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' data: blob: https: wss:; font-src 'self' data: https:; frame-src 'self' data: blob: https:; object-src 'none'; base-uri 'self'; form-action https:; frame-ancestors 'none'"
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range",
          "Access-Control-Max-Age": "86400"
        }
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed.", {
        status: 405,
        headers: { Allow: "GET, HEAD, OPTIONS" }
      });
    }

    try {
      const config = await readSiteConfig(env.GAMES_BUCKET);
      if (config.maintenance) return maintenanceResponse(request.method);
    } catch (error) {
      console.error("Could not determine whether GameSphere is in maintenance mode:", error);
      return new Response("Site settings are unavailable. Please try again later.", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": "300"
        }
      });
    }

    let segments;
    try {
      segments = new URL(request.url).pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
    } catch {
      return new Response("Invalid game path.", { status: 400 });
    }
    const isRomAsset = segments[0] === "roms";
    const gameId = isRomAsset ? segments[1] : segments[0];
    const pathParts = isRomAsset ? segments.slice(2) : segments.slice(1);
    if (!/^[a-f0-9]{32}$/.test(gameId || "")) {
      return new Response("Game not found.", { status: 404 });
    }

    let path = pathParts.join("/");
    if (pathParts.some(part =>
      part === "." ||
      part === ".." ||
      part.includes("/") ||
      part.includes("\\") ||
      part.includes("\0")
    )) {
      return new Response("Invalid game path.", { status: 400 });
    }
    if (!path || path.endsWith("/")) path += "index.html";

    const object = await env.GAMES_BUCKET.get(`${isRomAsset ? "roms" : "games"}/${gameId}/${path}`);
    if (!object) {
      return new Response("Game file not found.", { status: 404 });
    }

    const extension = path.split(".").pop()?.toLowerCase();
    const type = object.httpMetadata?.contentType || getAssetMimeType(path);
    const isGameEntry = (extension === "html" || extension === "htm") &&
      object.customMetadata?.gameEntry === "true";
    const headers = responseHeaders(type);
    if (isGameEntry) headers["Cache-Control"] = "public, max-age=300";
    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }

    if (isGameEntry) {
      const html = await new Response(object.body).text();
      const bridge = createSaveBridge(
        object.customMetadata.gameId || gameId,
        object.customMetadata.gameName || "Published game"
      );
      const bodyTag = /<body\b[^>]*>/i;
      const injectedHtml = bodyTag.test(html)
        ? html.replace(bodyTag, match => `${match}${bridge}`)
        : /<\/body\s*>/i.test(html)
          ? html.replace(/<\/body\s*>/i, `${bridge}</body>`)
          : `${html}${bridge}`;
      return new Response(injectedHtml, { headers });
    }

    return new Response(object.body, { headers });
  }
};
