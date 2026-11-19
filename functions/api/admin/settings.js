import { authorizeAdmin } from "../../_utils/admin-auth.js";
import { readSiteConfig, validateSiteConfig } from "../../_utils/site-config.js";

export async function onRequestGet({ request, env }) {
  const denied = await authorizeAdmin(request, env);
  if (denied) return denied;
  if (!env.GAMES_BUCKET) {
    return Response.json({ error: "Settings storage is not configured." }, { status: 503 });
  }

  try {
    return Response.json(await readSiteConfig(env.GAMES_BUCKET), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("Could not load admin settings:", error);
    return Response.json({ error: error.message || "Settings could not be loaded." }, { status: 500 });
  }
}

export async function onRequestPut({ request, env }) {
  const denied = await authorizeAdmin(request, env);
  if (denied) return denied;
  if (!env.GAMES_BUCKET) {
    return Response.json({ error: "Settings storage is not configured." }, { status: 503 });
  }
  if (Number(request.headers.get("Content-Length") || 0) > 16000) {
    return Response.json({ error: "Settings request is too large." }, { status: 413 });
  }

  let settings;
  try {
    settings = validateSiteConfig(await request.json());
  } catch (error) {
    return Response.json({ error: error.message || "Settings JSON is invalid." }, { status: 400 });
  }

  try {
    await env.GAMES_BUCKET.put("site-config/settings.json", JSON.stringify(settings), {
      httpMetadata: { contentType: "application/json; charset=utf-8" }
    });
    return Response.json({ settings });
  } catch (error) {
    console.error("Could not save admin settings:", error);
    return Response.json({ error: "Settings could not be saved to storage." }, { status: 502 });
  }
}
