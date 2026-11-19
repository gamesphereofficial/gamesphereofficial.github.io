function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), character => character.charCodeAt(0));
}

function decodeJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
}

function configurationError() {
  return Response.json({ error: "Admin Access is not configured on the server." }, { status: 503 });
}

export async function authorizeAdmin(request, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const audiences = env.ACCESS_AUD?.split(",").map(value => value.trim()).filter(Boolean) || [];
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!teamDomain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain) ||
      audiences.length === 0 || !adminEmail) {
    console.error("Admin API is missing ACCESS_TEAM_DOMAIN, ACCESS_AUD, or ADMIN_EMAIL.");
    return configurationError();
  }

  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) {
    return Response.json({ error: "Cloudflare Access authentication is required." }, { status: 401 });
  }

  const parts = assertion.split(".");
  if (parts.length !== 3) {
    return Response.json({ error: "Invalid Cloudflare Access token." }, { status: 401 });
  }

  let header;
  let claims;
  let signature;
  try {
    header = decodeJsonSegment(parts[0]);
    claims = decodeJsonSegment(parts[1]);
    signature = decodeBase64Url(parts[2]);
  } catch {
    return Response.json({ error: "Invalid Cloudflare Access token." }, { status: 401 });
  }
  if (!header || typeof header !== "object" || !claims || typeof claims !== "object" ||
      header.alg !== "RS256" || typeof header.kid !== "string") {
    return Response.json({ error: "Unsupported Cloudflare Access token." }, { status: 401 });
  }

  const issuer = `https://${teamDomain}`;
  if (claims.iss !== issuer ||
      !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).some(value => audiences.includes(value)) ||
      typeof claims.email !== "string" || claims.email.toLowerCase() !== adminEmail ||
      !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 ||
      (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > Date.now() / 1000))) {
    return Response.json({ error: "Cloudflare Access token is expired or not authorized." }, { status: 403 });
  }

  let keysResponse;
  try {
    keysResponse = await fetch(`${issuer}/cdn-cgi/access/certs`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
  } catch (error) {
    console.error("Could not retrieve Cloudflare Access signing keys:", error);
    return Response.json({ error: "Could not verify Cloudflare Access authentication." }, { status: 503 });
  }
  if (!keysResponse.ok) {
    console.error("Could not retrieve Cloudflare Access signing keys:", keysResponse.status);
    return Response.json({ error: "Could not verify Cloudflare Access authentication." }, { status: 503 });
  }
  let keySet;
  try {
    keySet = await keysResponse.json();
  } catch (error) {
    console.error("Cloudflare Access returned invalid signing keys:", error);
    return Response.json({ error: "Could not verify Cloudflare Access authentication." }, { status: 503 });
  }
  const jwk = keySet.keys?.find(key => key.kid === header.kid && key.alg === "RS256" && key.kty === "RSA");
  if (!jwk) {
    return Response.json({ error: "Cloudflare Access signing key was not recognized." }, { status: 401 });
  }

  let verified;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signature,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch (error) {
    console.error("Could not verify Cloudflare Access token:", error);
    return Response.json({ error: "Could not verify Cloudflare Access authentication." }, { status: 503 });
  }
  if (!verified) {
    return Response.json({ error: "Cloudflare Access token signature is invalid." }, { status: 401 });
  }
  return null;
}
