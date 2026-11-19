import { readSiteConfig } from "../_utils/site-config.js";

export async function onRequestGet({ env }) {
  if (!env.GAMES_BUCKET) {
    return Response.json({ error: "Site configuration storage is not configured." }, { status: 503 });
  }
  try {
    return Response.json(await readSiteConfig(env.GAMES_BUCKET), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("Could not load site settings:", error);
    return Response.json({ error: error.message || "Site settings could not be loaded." }, { status: 500 });
  }
}
