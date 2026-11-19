function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function onRequestGet({ env }) {
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
          (game.visibility === "my-games" || game.visibility === "public"))
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
    console.error("Could not list games in My Games:", error);
    return json({ error: "Games in My Games could not be loaded." }, 500);
  }
}
