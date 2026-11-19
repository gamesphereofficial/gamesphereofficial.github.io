import { zipSync } from "fflate";
import { getRetroSystem, MAX_RETRO_FILE_BYTES, validateRetroFiles } from "./retro-game.js";

const ROM_PLAYER_DOCUMENT = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#game{width:100%;height:100%;margin:0;background:#080a12}body{overflow:hidden}</style></head>
<body><div id="game"></div><script>
let gameStarted = false;
let startupErrorReported = false;
function reportStartupError(message) {
  if (gameStarted || startupErrorReported) return;
  startupErrorReported = true;
  parent.postMessage({type:"gamesphere-retro-error", message:"Emulator startup failed: " + message}, "*");
}
window.addEventListener("error", function(event) {
  reportStartupError(event.message || "An unexpected error occurred.");
});
window.addEventListener("unhandledrejection", function(event) {
  reportStartupError(event.reason && event.reason.message ? event.reason.message : String(event.reason));
});
window.addEventListener("message", function(event) {
  if (event.source !== parent || !event.data || event.data.type !== "gamesphere-retro-start") return;
  const game = event.data;
  window.EJS_player = "#game";
  window.EJS_core = game.core;
  window.EJS_gameName = game.name;
  window.EJS_pathtodata = "https://cdn.emulatorjs.org/stable/data/";
  const storage = new Map();
  Object.defineProperty(window, "localStorage", {configurable:true, value:{
    get length() { return storage.size; },
    clear() { storage.clear(); },
    getItem(key) { return storage.get(String(key)) ?? null; },
    key(index) { return [...storage.keys()][index] ?? null; },
    removeItem(key) { storage.delete(String(key)); },
    setItem(key, value) { storage.set(String(key), String(value)); }
  }});
  Object.defineProperty(window, "indexedDB", {configurable:true, value:undefined});
  window.EJS_disableLocalStorage = true;
  window.EJS_threads = game.core === "psp";
  window.EJS_startOnLoaded = true;
  window.EJS_disableAutoLang = false;
  window.EJS_ready = function() { parent.postMessage({type:"gamesphere-retro-status", status:"Emulator ready. Loading game…"}, "*"); };
  window.EJS_onGameStart = function() {
    gameStarted = true;
    parent.postMessage({type:"gamesphere-retro-status", status:"Game started."}, "*");
  };
  window.EJS_gameUrl = game.file ? URL.createObjectURL(game.file) : game.url;
  const loader = document.createElement("script");
  loader.src = window.EJS_pathtodata + "loader.js";
  loader.onerror = function() { reportStartupError("EmulatorJS could not load. Check your internet connection and try again."); };
  document.head.appendChild(loader);
}, {once:true});
</script></body></html>`;

const SYSTEM_LABELS = {
  n64: "Nintendo 64",
  ps1: "PlayStation (PBP)",
  psp: "PSP (PBP)",
  nes: "NES",
  gba: "Game Boy Advance",
  gbc: "Game Boy Color",
  gb: "Game Boy",
  snes: "SNES / SFC",
  arcade: "FBA / FBNeo arcade",
  "bin-cue": "PlayStation BIN + CUE"
};
const MAX_FILE_COUNT = 8;
const ROM_API_ORIGIN = window.GAMESPHERE_CONFIG?.romApiOrigin || "";
const romApiUrl = path => ROM_API_ORIGIN ? new URL(path, ROM_API_ORIGIN).href : path;

const input = document.getElementById("retro-file-input");
const systemSelect = document.getElementById("retro-system-select");
const titleInput = document.getElementById("retro-game-title-input");
const rightsCheckbox = document.getElementById("retro-rights-confirm");
const playButton = document.getElementById("retro-play-button");
const publishButton = document.getElementById("retro-publish-button");
const status = document.getElementById("retro-upload-status");
const publicGrid = document.getElementById("retro-public-grid");
const modal = document.getElementById("retro-game-modal");
const frame = document.getElementById("retro-game-frame");
const modalTitle = document.getElementById("retro-game-title");
const playerStatus = document.getElementById("retro-player-status");
const closeButton = document.getElementById("retro-game-close");
const fullscreenButton = document.getElementById("retro-game-fullscreen");
const turnstileSiteKey = window.GAMESPHERE_CONFIG?.turnstileSiteKey || "";
let turnstileWidgetId = null;
let selectedFiles = [];
let currentTitle = "";

function setStatus(message) {
  status.textContent = message;
}

function setPlayerStatus(message) {
  playerStatus.textContent = message;
}

function loadTurnstile() {
  if (!turnstileSiteKey || turnstileSiteKey === "YOUR_TURNSTILE_SITE_KEY") return;
  if (window.turnstile) {
    renderTurnstile();
    return;
  }
  const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]');
  if (existing) {
    existing.addEventListener("load", renderTurnstile, { once: true });
    return;
  }
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.onload = renderTurnstile;
  script.onerror = () => setStatus("Upload verification could not load. Check your internet connection.");
  document.head.appendChild(script);
}

function renderTurnstile() {
  const container = document.getElementById("retro-turnstile-container");
  if (container && window.turnstile && turnstileWidgetId === null) {
    turnstileWidgetId = window.turnstile.render(container, { sitekey: turnstileSiteKey, theme: "dark" });
  }
}

function sanitizeTitle(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "Retro game";
}

function makeRomFile(files, systemId) {
  if (systemId !== "bin-cue") return files[0];
  const entries = {};
  return Promise.all(files.map(async file => {
    entries[file.name] = new Uint8Array(await file.arrayBuffer());
  })).then(() => new File([zipSync(entries, { level: 0 })], "game-bundle.zip", { type: "application/zip" }));
}

async function validateSelection() {
  const files = [...input.files];
  if (!files.length) throw new Error("Choose a game file first.");
  if (files.length > MAX_FILE_COUNT) throw new Error(`Choose no more than ${MAX_FILE_COUNT} files.`);
  const system = await validateRetroFiles(systemSelect.value, files);
  return { files, system };
}

async function chooseFiles() {
  try {
    const selection = await validateSelection();
    selectedFiles = selection.files;
    currentTitle = sanitizeTitle(titleInput.value || selectedFiles[0].name.replace(/\.[^.]+$/, ""));
    if (!titleInput.value.trim()) titleInput.value = currentTitle;
    setStatus(`${SYSTEM_LABELS[systemSelect.value]} game ready: ${selectedFiles.map(file => file.name).join(", ")}. Choose Play locally or publish online.`);
    playButton.disabled = false;
    publishButton.disabled = false;
  } catch (error) {
    selectedFiles = [];
    playButton.disabled = true;
    publishButton.disabled = true;
    setStatus(error.message);
  }
}

async function launchGame(game) {
  const system = getRetroSystem(game.system);
  if (!system) throw new Error("This published game uses an unsupported system.");
  if (system.requiresThreads && !window.crossOriginIsolated) {
    throw new Error("PSP games need a host configured with cross-origin isolation headers. This site is not currently isolated.");
  }
  if (!game.file && (!game.url || new URL(game.url).protocol !== "https:")) {
    throw new Error("The published game has an invalid file URL.");
  }

  modalTitle.textContent = game.name;
  modal.hidden = false;
  document.body.classList.add("local-game-open");
  setPlayerStatus("Loading the emulator and game file. Keep this page open.");
  frame.title = `${game.name} emulator`;
  frame.addEventListener("load", () => {
    frame.contentWindow.postMessage({
      type: "gamesphere-retro-start",
      core: system.core,
      name: game.name,
      ...(game.file ? { file: game.file } : { url: game.url })
    }, "*");
  }, { once: true });
  frame.srcdoc = ROM_PLAYER_DOCUMENT;
}

function closeGame() {
  frame.srcdoc = "";
  modal.hidden = true;
  document.body.classList.remove("local-game-open");
}

function validPublishedRom(rom) {
  if (!rom || typeof rom.id !== "string" || !/^[a-f0-9]{32}$/.test(rom.id) ||
      typeof rom.name !== "string" || !getRetroSystem(rom.system) ||
      typeof rom.assetUrl !== "string" || typeof rom.playUrl !== "string") return false;
  try {
    return new URL(rom.assetUrl).protocol === "https:" &&
      new URL(rom.playUrl).origin === window.location.origin;
  } catch {
    return false;
  }
}

function saveRomShortcut(rom) {
  try {
    const key = "gamesphere.savedGames.v1";
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(saved)) throw new Error("Saved retro games are not a list.");
    const updated = saved.filter(item => item?.id !== rom.id);
    updated.unshift({ id: rom.id, name: rom.name, playUrl: rom.playUrl });
    localStorage.setItem(key, JSON.stringify(updated.slice(0, 100)));
    window.GameSphereShowToast?.(`"${rom.name}" was saved to this browser's library.`);
  } catch (error) {
    console.error("Could not save retro game shortcut:", error);
    window.GameSphereShowToast?.("Could not save this game shortcut on this device.");
  }
}

function renderPublicRoms(roms) {
  publicGrid.replaceChildren();
  for (const rom of roms.filter(validPublishedRom)) {
    const card = document.createElement("article");
    card.className = "game-card published-game-card";
    card.dataset.title = `${rom.name} ${SYSTEM_LABELS[rom.system]}`;
    const cover = document.createElement("div");
    cover.className = "cover cover-upload";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = SYSTEM_LABELS[rom.system];
    const info = document.createElement("div");
    info.className = "card-info";
    const title = document.createElement("h3");
    title.textContent = rom.name;
    const meta = document.createElement("div");
    meta.className = "card-meta";
    const author = document.createElement("span");
    author.textContent = "Community";
    const label = document.createElement("span");
    label.className = "rating";
    label.textContent = "PLAY";
    meta.append(author, label);
    const actions = document.createElement("div");
    actions.className = "saved-game-actions";
    const play = document.createElement("button");
    play.className = "library-button primary";
    play.type = "button";
    play.textContent = "Play";
    play.addEventListener("click", async () => {
      try {
        await launchGame({ system: rom.system, name: rom.name, url: rom.assetUrl });
      } catch (error) {
        window.GameSphereShowToast?.(error.message);
      }
    });
    const save = document.createElement("button");
    save.className = "library-button";
    save.type = "button";
    save.textContent = "Save game";
    save.addEventListener("click", () => saveRomShortcut(rom));
    actions.append(play, save);
    info.append(title, meta, actions);
    card.append(cover, info);
    cover.appendChild(tag);
    publicGrid.appendChild(card);
  }
  publicGrid.hidden = publicGrid.children.length === 0;
  document.getElementById("retro-public-empty").hidden = publicGrid.children.length > 0;
}

async function loadPublicRoms() {
  if (!["http:", "https:"].includes(window.location.protocol)) return;
  try {
    const response = await fetch(romApiUrl("/api/roms"), { cache: "no-store" });
    if (!response.ok) throw new Error(`GameSphere hosting service returned ${response.status}.`);
    const result = await response.json();
    if (!Array.isArray(result.roms)) throw new Error("GameSphere returned an invalid retro game list.");
    renderPublicRoms(result.roms);
  } catch (error) {
    console.error("Could not load published retro games:", error);
    document.getElementById("retro-public-empty").textContent =
      "Public retro games are unavailable until the Cloudflare game hosting service is deployed.";
  }
}

function resetTurnstile() {
  if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
}

async function publishGame() {
  if (!rightsCheckbox.checked) {
    setStatus("Confirm that you own or have permission to publicly distribute these game files.");
    return;
  }
  if (!turnstileSiteKey || !window.turnstile || turnstileWidgetId === null) {
    setStatus("Online publishing needs the Cloudflare upload verification and hosting backend.");
    return;
  }
  const token = window.turnstile.getResponse(turnstileWidgetId);
  if (!token) {
    setStatus("Complete the upload verification before publishing.");
    return;
  }

  try {
    const selection = await validateSelection();
    const uploadFile = await makeRomFile(selection.files, systemSelect.value);
    if (uploadFile.size > MAX_RETRO_FILE_BYTES) throw new Error("The complete game bundle must be 96 MB or smaller.");
    const title = sanitizeTitle(titleInput.value || uploadFile.name.replace(/\.[^.]+$/, ""));
    publishButton.disabled = true;
    playButton.disabled = true;
    setStatus("Publishing authorized game…");
    const rom = await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", romApiUrl("/api/roms"));
      request.responseType = "json";
      request.setRequestHeader("Content-Type", "application/octet-stream");
      request.setRequestHeader("X-ROM-System", systemSelect.value);
      request.setRequestHeader("X-ROM-Name", encodeURIComponent(title));
      request.setRequestHeader("X-ROM-Filename", encodeURIComponent(uploadFile.name));
      request.setRequestHeader("X-ROM-Rights-Confirmed", "true");
      request.setRequestHeader("X-Turnstile-Token", token);
      request.upload.addEventListener("progress", event => {
        if (event.lengthComputable) {
          setStatus(`Uploading game… ${Math.round(event.loaded / event.total * 100)}%`);
        }
      });
      request.addEventListener("load", () => {
        const response = request.response || {};
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(response.error || `GameSphere hosting service returned ${request.status}.`));
          return;
        }
        resolve(response);
      });
      request.addEventListener("error", () => reject(new Error("The upload connection failed. Check your internet connection and try again.")));
      request.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));
      request.send(uploadFile);
    });
    resetTurnstile();
    try {
      window.GameSphereAddMyGame?.({ id: rom.id, name: rom.name, playUrl: rom.playUrl });
    } catch (error) {
      console.error("Published retro game could not be added to My Games:", error);
    }
    setStatus(`"${rom.name}" is published to Public Games. Earlier games remain available.`);
    await loadPublicRoms();
  } catch (error) {
    console.error("Could not publish retro game:", error);
    setStatus(`Could not publish the game: ${error.message}`);
    resetTurnstile();
  } finally {
    publishButton.disabled = false;
    playButton.disabled = false;
  }
}

input.addEventListener("change", chooseFiles);
systemSelect.addEventListener("change", () => {
  selectedFiles = [];
  playButton.disabled = true;
  publishButton.disabled = true;
  if (input.files.length) chooseFiles();
});
titleInput.addEventListener("input", () => {
  currentTitle = sanitizeTitle(titleInput.value);
});
playButton.addEventListener("click", async () => {
  try {
    const selection = await validateSelection();
    const file = await makeRomFile(selection.files, systemSelect.value);
    await launchGame({ system: systemSelect.value, name: currentTitle || sanitizeTitle(titleInput.value || file.name), file });
  } catch (error) {
    setStatus(error.message);
  }
});
publishButton.addEventListener("click", publishGame);
closeButton.addEventListener("click", closeGame);
modal.addEventListener("click", event => {
  if (event.target === modal) closeGame();
});
fullscreenButton.addEventListener("click", async () => {
  try {
    await frame.requestFullscreen();
  } catch (error) {
    window.GameSphereShowToast?.(`Could not enter full screen: ${error.message}`);
  }
});
window.addEventListener("message", event => {
  if (event.source !== frame.contentWindow || !event.data) return;
  if (event.data.type === "gamesphere-retro-status" && typeof event.data.status === "string") {
    setPlayerStatus(event.data.status);
  } else if (event.data.type === "gamesphere-retro-error" && typeof event.data.message === "string") {
    setPlayerStatus(event.data.message);
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !modal.hidden) closeGame();
});
loadTurnstile();
loadPublicRoms();

const requestedGameId = new URLSearchParams(window.location.search).get("retroGame");
if (requestedGameId) {
  if (!/^[a-f0-9]{32}$/.test(requestedGameId)) {
    window.GameSphereShowToast?.("This retro game link is invalid.");
  } else {
    fetch(`${romApiUrl("/api/roms")}?id=${encodeURIComponent(requestedGameId)}`, { cache: "no-store" })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "This retro game could not be loaded.");
        if (!validPublishedRom(result)) throw new Error("This retro game has invalid publishing data.");
        await launchGame({ system: result.system, name: result.name, url: result.assetUrl });
      })
      .catch(error => {
        console.error("Could not open published retro game:", error);
        window.GameSphereShowToast?.(error.message);
      });
  }
}

window.GameSphereRetro = { launchGame, loadPublicRoms };
