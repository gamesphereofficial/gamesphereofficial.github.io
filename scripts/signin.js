import { createAuth0Client } from "@auth0/auth0-spa-js";

const config = window.GAMESPHERE_CONFIG?.auth0;
const status = document.getElementById("signin-status");
const setupNote = document.getElementById("setup-note");
const signinContent = document.getElementById("signin-content");
const accountPanel = document.getElementById("account-panel");
const callbackUrl = new URL("/signin.html", window.location.origin).href;
const requestedReturn = new URLSearchParams(window.location.search).get("returnTo");
const returnTo = requestedReturn && requestedReturn.startsWith("/") &&
  !requestedReturn.startsWith("//") && !requestedReturn.includes("\\")
  ? requestedReturn
  : "/";

function showStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#ffaaa8" : "";
}

function configuredConnection(name) {
  return typeof config?.connections?.[name] === "string" && config.connections[name].trim().length > 0;
}

let auth0Client;

async function showSignedIn(user) {
  signinContent.hidden = true;
  accountPanel.hidden = false;
  document.getElementById("account-name").textContent = user.name || user.email || "GameSphere player";
  document.getElementById("continue-link").href = returnTo;
}

async function initialize() {
  const providerButtons = [...document.querySelectorAll("[data-connection]")];
  const hasAuthConfig = typeof config?.domain === "string" && config.domain.length > 0 &&
    typeof config?.clientId === "string" && config.clientId.length > 0;
  if (!hasAuthConfig) {
    providerButtons.forEach(button => { button.disabled = true; });
    setupNote.hidden = false;
    showStatus("Authentication provider configuration is missing.", true);
    return;
  }

  auth0Client = await createAuth0Client({
    domain: config.domain,
    clientId: config.clientId,
    cacheLocation: "memory",
    authorizationParams: { redirect_uri: callbackUrl }
  });

  for (const button of providerButtons) {
    const provider = button.dataset.connection;
    button.disabled = !configuredConnection(provider);
    if (!configuredConnection(provider)) {
      button.title = provider === "epic"
        ? "Epic Games needs a configured custom Auth0 connection."
        : "This Auth0 connection is not configured.";
    }
    button.addEventListener("click", async () => {
      if (!configuredConnection(provider)) return;
      button.disabled = true;
      showStatus(`Connecting to ${button.textContent.trim().replace(/^Continue with /, "").replace(/^Sign in with /, "")}…`);
      try {
        await auth0Client.loginWithRedirect({
          authorizationParams: {
            connection: config.connections[provider],
            redirect_uri: callbackUrl,
            ...(provider === "gamesphere" ? { screen_hint: "login" } : {})
          },
          appState: { returnTo }
        });
      } catch (error) {
        console.error("Could not start Auth0 sign-in:", error);
        showStatus("Could not start sign-in. Check the Auth0 configuration and try again.", true);
        button.disabled = false;
      }
    });
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has("error")) {
    showStatus(params.get("error_description") || "Sign-in was cancelled or could not be completed.", true);
    window.history.replaceState({}, document.title, "/signin.html");
  } else if (params.has("code") && params.has("state")) {
    try {
      const { appState } = await auth0Client.handleRedirectCallback();
      const user = await auth0Client.getUser();
      window.history.replaceState({}, document.title, "/signin.html");
      if (!user) throw new Error("Auth0 completed the callback without returning a user profile.");
      if (appState?.returnTo && appState.returnTo.startsWith("/") &&
          !appState.returnTo.startsWith("//") && !appState.returnTo.includes("\\")) {
        document.getElementById("continue-link").href = appState.returnTo;
      }
      await showSignedIn(user);
    } catch (error) {
      console.error("Auth0 sign-in callback failed:", error);
      showStatus("Sign-in could not be completed. Verify the Auth0 callback URL and try again.", true);
      window.history.replaceState({}, document.title, "/signin.html");
    }
  } else {
    try {
      await auth0Client.getTokenSilently();
      const user = await auth0Client.getUser();
      if (user) await showSignedIn(user);
    } catch (error) {
      if (error.error !== "login_required" && error.error !== "missing_refresh_token") {
        console.error("Could not restore the Auth0 session:", error);
        showStatus("Could not check your sign-in session. You can still try signing in.", true);
      }
    }
  }

  document.getElementById("signout-button").addEventListener("click", () => {
    auth0Client.logout({
      logoutParams: { returnTo: new URL("/signin.html", window.location.origin).href }
    });
  });
}

initialize().catch(error => {
  console.error("Could not initialize Auth0:", error);
  setupNote.hidden = false;
  showStatus("Authentication could not be initialized. Check the Auth0 domain and client ID.", true);
});
