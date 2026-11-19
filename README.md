# GameSphere

### Our Games. Our Universe.

Welcome to GameSphere, a gaming platform project designed to bring games together in one place.

## About GameSphere

GameSphere aims to provide a modern gaming experience where players can discover, explore, and play games.

## Planned Features

- Game collection and discovery
- HTML5 game support
- Game information and descriptions
- User-friendly interface
- Game submission system
- Downloadable game versions
- Responsive design for different devices

## Website

https://gamesphereofficial.github.io

## Project Status

🚧 Under development.

More features and updates will be added as development continues.

## Browser retro games

The browser player supports N64 (`.n64`, `.v64`, `.z64`), PlayStation and PSP (`.pbp`), NES (`.nes`), GBA (`.gba`), GBC (`.gbc`), GB (`.gb`), SNES/SFC (`.smc`, `.sfc`), FBNeo/FBA arcade (`.zip`), and PlayStation BIN+CUE bundles. BIN+CUE games are selected together and packaged in the browser. EmulatorJS is loaded from its official CDN, so playback needs an internet connection. PSP playback additionally requires cross-origin isolation headers from the website host.

Public retro-game publishing uses the Cloudflare Pages Function at `/api/roms`, the existing R2 game bucket, and the game-host Worker. The static GitHub Pages site calls the backend at `https://gamesphere.pages.dev` by default; override this with `GAMESPHERE_ROM_API_ORIGIN` when the Pages project uses another URL. Configure the Pages `GAME_ORIGIN` variable and `TURNSTILE_SECRET_KEY` secret, keep the game host on its own origin, and set `SITE_ORIGIN` to `https://gamesphereofficial.github.io`. Build with `GAMESPHERE_TURNSTILE_SITE_KEY` for the public site. GitHub Pages remains static; the Cloudflare Pages project must separately be deployed with its R2 binding and Functions. Public uploads must be homebrew, public-domain, or otherwise authorized for distribution.

## Contact

For questions or suggestions, please use the GitHub repository's Issues section.

---

**GameSphere — Our Games. Our Universe.**

