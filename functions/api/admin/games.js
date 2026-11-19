import { authorizeAdmin } from "../../_utils/admin-auth.js";

const GAME_ID_PATTERN = /^[a-f0-9]{32}$/;

async function listAllObjects(bucket, prefix, includeMetadata = false) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
      ...(includeMetadata ? { include: ["customMetadata"] } : {})
    });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
    if (page.truncated && !cursor) throw new Error("Storage pagination returned no cursor.");
  } while (cursor);
  return objects;
}

export async function onRequestGet({ request, env }) {
  const denied = await authorizeAdmin(request, env);
  if (denied) return denied;
  if (!env.GAMES_BUCKET) {
    return Response.json({ error: "Game storage is not configured." }, { status: 503 });
  }

  try {
    const [catalog, romCatalog] = await Promise.all([
      listAllObjects(env.GAMES_BUCKET, "catalog/", true),
      listAllObjects(env.GAMES_BUCKET, "rom-catalog/", true)
    ]);
    const games = catalog
      .map(object => object.customMetadata)
      .filter(game => game?.gameId && game?.name && game?.playUrl)
      .map(game => ({
        id: game.gameId,
        name: game.name,
        playUrl: game.playUrl,
        publishedAt: game.publishedAt
      }))
      .concat(romCatalog
        .map(object => object.customMetadata)
        .filter(game => game?.gameId && game?.name && game?.playUrl && game?.system)
        .map(game => ({
          id: game.gameId,
          name: `${game.name} (${game.system.toUpperCase()})`,
          playUrl: game.playUrl,
          publishedAt: game.publishedAt
        })));
    return Response.json({ games }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load admin game catalogue:", error);
    return Response.json({ error: "The game catalogue could not be loaded." }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const denied = await authorizeAdmin(request, env);
  if (denied) return denied;
  if (!env.GAMES_BUCKET) {
    return Response.json({ error: "Game storage is not configured." }, { status: 503 });
  }

  let gameId;
  try {
    gameId = (await request.json()).id;
  } catch {
    return Response.json({ error: "Provide a game ID in the JSON request body." }, { status: 400 });
  }
  if (typeof gameId !== "string" || !GAME_ID_PATTERN.test(gameId)) {
    return Response.json({ error: "The game ID is invalid." }, { status: 400 });
  }

  try {
    const [gameObjects, catalogObjects, romObjects, romCatalogObjects] = await Promise.all([
      listAllObjects(env.GAMES_BUCKET, `games/${gameId}/`),
      listAllObjects(env.GAMES_BUCKET, "catalog/", true),
      listAllObjects(env.GAMES_BUCKET, `roms/${gameId}/`),
      listAllObjects(env.GAMES_BUCKET, `rom-catalog/${gameId}.json`)
    ]);
    const matchingCatalog = catalogObjects
      .filter(object => object.customMetadata?.gameId === gameId)
      .map(object => object.key);
    const keys = [
      ...gameObjects.map(object => object.key),
      ...matchingCatalog,
      ...romObjects.map(object => object.key),
      ...romCatalogObjects.map(object => object.key)
    ];
    if (keys.length === 0) {
      return Response.json({ error: "This game was not found." }, { status: 404 });
    }

    for (let index = 0; index < keys.length; index += 1000) {
      await env.GAMES_BUCKET.delete(keys.slice(index, index + 1000));
    }
    return Response.json({ deleted: true, id: gameId, deletedObjects: keys.length });
  } catch (error) {
    console.error(`Could not delete published game ${gameId}:`, error);
    return Response.json({ error: "The game could not be permanently deleted." }, { status: 502 });
  }
}
