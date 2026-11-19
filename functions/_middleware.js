import { readSiteConfig } from "./_utils/site-config.js";
import { maintenanceResponse } from "./_utils/maintenance-page.js";

export async function onRequest({ request, env, next }) {
  const path = new URL(request.url).pathname;
  if (path === "/admin.html" || path.startsWith("/api/admin/")) {
    return next();
  }
  if (!env.GAMES_BUCKET) {
    console.error("Site maintenance check cannot access the game storage binding.");
    return new Response("Site settings are unavailable.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  try {
    const config = await readSiteConfig(env.GAMES_BUCKET);
    if (config.maintenance) {
      return maintenanceResponse(request.method);
    }
  } catch (error) {
    console.error("Could not determine whether GameSphere is in maintenance mode:", error);
    return new Response("Site settings are unavailable. Please try again later.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
  return next();
}
