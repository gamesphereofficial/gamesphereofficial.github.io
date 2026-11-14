import { createAuth0Client } from "@auth0/auth0-spa-js";

const config = window.GAMESPHERE_CONFIG?.auth0;
async function restoreAccount() {
  if (!config?.domain || !config?.clientId) return;
  try {
    const client = await createAuth0Client({
      domain: config.domain,
      clientId: config.clientId,
      cacheLocation: "memory",
      authorizationParams: { redirect_uri: new URL("/signin.html", window.location.origin).href }
    });
    await client.getTokenSilently();
    const user = await client.getUser();
    if (user) {
      const accountLink = document.getElementById("account-link");
      const displayName = user.name || user.email || "GameSphere player";
      accountLink.textContent = "Account";
      accountLink.title = `Signed in as ${displayName}`;
      accountLink.setAttribute("aria-label", `GameSphere account for ${displayName}`);
    }
  } catch (error) {
    if (error.error !== "login_required" && error.error !== "missing_refresh_token") {
      console.error("Could not restore the GameSphere account session:", error);
    }
  }
}

restoreAccount();
