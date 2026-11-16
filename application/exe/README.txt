GAMESPHERE WINDOWS DESKTOP APP

This folder contains the Windows desktop-app source project. It opens the
website files built from the GameSphere project, so it uses the same HTML,
CSS, images, colors, fonts, and default site configuration as index.html.
The app serves those packaged files using its built-in app protocol and does
not need a local HTTP server. For direct browser use, open the project-root
index.html after running npm run build; the build creates the required
local-game.js and configuration files alongside it. Do not open the
temporary site folder from a packaging build.

BUILD THE WINDOWS INSTALLER

1. Install Node.js LTS on Windows.
2. Open this folder in File Explorer.
3. Double-click build-windows.bat and wait for the build to finish.
   Or open PowerShell in this folder and run:

     npm install --prefix ..\..
     npm install
     npm run dist:win

4. The versioned installer will be created in:

     application\exe\release\GameSphere-Setup-1.0.1.exe

The first build needs an internet connection to download Electron and its
packaging tools. The Windows installer is unsigned, so Windows SmartScreen may
show an unknown-publisher warning. Do not distribute the installer publicly
until you have tested and code-signed it.

APP WEBSITE AND ONLINE SERVICES

The app bundles the current website UI. Its external fonts, artwork, and
hosted services need an internet connection.
The bundled desktop app includes the latest Public Games and My Games interface.
ZIPs opened in bundled mode are saved in this Windows user's local game library,
which survives app restarts but is not shared with other users or the public site.
Shared publishing, cross-device My Games, and hosted community listings require
the public GameSphere website and backend. Cloudflare R2 must be enabled and the
configured gamesphere-games bucket created before the backend can store uploads.
When hosted services are available, each hosted upload is listed in both My
Games and Public Games; publishing another game adds an entry and does not
replace earlier games.
The site lets you play a selected standalone HTML file or HTML5 game ZIP
directly in an isolated browser frame without localhost. A single HTML file
must embed its code and assets or use public HTTPS URLs; choose ZIP for games
that need separate files. Local HTML and ZIP files are limited to 10 MB, and
ZIPs also allow up to 750 files and 48 MB extracted. Local play requires the
project-root local-game.js created by npm run build. Games that require a
server, service workers, or relative imports from browser modules may not work
in local-play mode. The game frame permits autoplay for game audio and video,
and dynamically assigned media URLs in ZIPs are resolved to files in the ZIP.
GDevelop exports show their startup resource progress and start after the first
scene and asynchronous libraries finish loading. Other HTML5 engines may have
their own loading behavior after the game document opens.
GDevelop's built-in Storage and Save State features store saves in browser
storage on this device, separately for each selected game ZIP.
The game viewer's Full screen button expands the selected game to the screen;
press Escape to leave full-screen mode.
Local play permits authentication popups while keeping the game frame
sandboxed. Auth0 and Firebase may reject sign-in in local play because its
opaque browser origin cannot be registered as an allowed domain; use the
published HTTPS game URL for provider sign-in in that case.

ONLINE GAME SIGN-IN

The hosted game server permits HTTPS auth requests, OAuth forms, and provider
popups. Each game owner must still configure their own provider project:

- Firebase Authentication: enable the provider and add the configured GameSphere
  GAME_ORIGIN hostname to Firebase Authorized domains. Configure the OAuth
  provider's redirect handler according to Firebase's project settings.
- Auth0: add the game host origin to Allowed Web Origins and the exact callback
  URL used by the game to Allowed Callback URLs; use the game's own domain,
  client ID, and callback configuration.

Provider setup varies by project and is not supplied by GameSphere. Never put
provider client secrets, Firebase service-account keys, or Admin SDK credentials
inside a game ZIP; browser games must use only provider-approved public client
configuration.

Until the backend is deployed, publishing from the bundled app explains that
online publishing is unavailable. The app never falls back to a local server.
Run GameSphere.exe (or build with npm start) for the desktop version. To use
a deployed HTTPS site instead of the bundled website, set this before
npm run dist:win:

  $env:GAMESPHERE_DESKTOP_URL = "https://your-gamesphere-domain.example"

If Auth0 sign-in uses a custom Auth0 domain, configure:

  $env:GAMESPHERE_AUTH0_DOMAIN = "login.your-domain.example"

These values are public application settings, not secrets. Provider sign-in
also requires the hosted website's Auth0 application to be configured with
the correct callback and logout URLs. The hosted website, published games,
uploads, and accounts remain online services.

SECURITY

The app requires HTTPS for its configured website. Node integration is
disabled, context isolation and Chromium sandboxing are enabled, webviews and
website permission requests are denied, and external links open in the default
browser. Only the configured GameSphere origin and known sign-in provider
origins can navigate inside the app window.
