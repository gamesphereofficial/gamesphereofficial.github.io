export const MAINTENANCE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>GameSphere is taking a break</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090b16;color:#f5f5fb;font:16px system-ui,sans-serif;text-align:center}.box{max-width:520px;padding:32px}.orb{font-size:56px;color:#9b75ff}p{color:#a2a6bd;line-height:1.7}</style></head>
<body><main class="box"><div class="orb">◈</div><h1>GameSphere is taking a short break</h1><p>We’re working on the site. Please check back soon.</p></main></body></html>`;

export function maintenanceResponse(method = "GET") {
  return new Response(method === "HEAD" ? null : MAINTENANCE_PAGE, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "300",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}
