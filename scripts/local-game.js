import {
  MAX_LOCAL_ZIP_BYTES,
  resolveGameAssetPath,
  unpackLocalGameAsync
} from "./local-game-archive.js";
import { getAssetMimeType } from "./asset-mime-types.js";
import { createGDevelopProgressBridge } from "./local-game-progress.js";
import {
  createGameStorageNamespace,
  createGDevelopLocalStorageBridge,
  createGDevelopStorageBridge,
  handleGDevelopStorageRequest
} from "./local-game-storage.js";

const GDEVELOP_STORAGE_PREFETCH_TIMEOUT_MS = 1500;

window.GameSphereLocalGames = Object.freeze({
  isAvailable: true
});

function toDataUrl(path, bytes, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.timeout = 8000;
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not prepare game resource "${path}".`));
        return;
      }
      onProgress(bytes.byteLength);
      resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error || new Error(`Could not read game resource "${path}".`));
    reader.onabort = () => reject(new Error(`Reading game resource "${path}" was cancelled.`));
    reader.ontimeout = () => reject(new Error(`Preparing game resource "${path}" timed out.`));
    reader.onprogress = event => onProgress(event.loaded);
    reader.readAsDataURL(new Blob([bytes], { type: getAssetMimeType(path, bytes) }));
  });
}

function preserveSuffix(originalReference, mappedUrl) {
  const suffixIndex = originalReference.search(/[?#]/);
  return suffixIndex < 0 ? mappedUrl : `${mappedUrl}${originalReference.slice(suffixIndex)}`;
}

function rewriteCss(css, currentPath, fileUrls) {
  return css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, quote, reference) => {
    const assetPath = resolveGameAssetPath(reference, currentPath);
    const mapped = assetPath && fileUrls.get(assetPath);
    return mapped ? `url("${preserveSuffix(reference, mapped)}")` : match;
  });
}

function createRuntimeBridge(assetMap) {
  const encodedAssetMap = JSON.stringify(assetMap).replace(/</g, "\\u003c");
  return `<script>(()=>{const assets=${encodedAssetMap};const base=new URL(document.baseURI);const resolve=value=>{try{const url=new URL(typeof value==="string"?value:value.url,base);if(url.origin!==base.origin)return null;const key=decodeURIComponent(url.pathname).replace(/^\\/+|\\/$/g,"");return assets[key]||null}catch{return null}};const fetchOriginal=window.fetch.bind(window);window.fetch=(input,init)=>{const mapped=resolve(input);return fetchOriginal(mapped||input,init)};const openOriginal=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){return openOriginal.call(this,method,resolve(url)||url,...rest)};const setOriginal=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){if(["src","href","poster","data","xlink:href"].includes(String(name).toLowerCase())){const mapped=resolve(value);if(mapped)value=mapped}return setOriginal.call(this,name,value)};for(const type of [window.HTMLImageElement,window.HTMLScriptElement,window.HTMLMediaElement,window.HTMLAudioElement,window.HTMLVideoElement,window.HTMLSourceElement,window.HTMLTrackElement,window.HTMLIFrameElement,window.HTMLLinkElement]){const descriptor=type&&Object.getOwnPropertyDescriptor(type.prototype,"src")||type&&Object.getOwnPropertyDescriptor(type.prototype,"href");if(!descriptor||!descriptor.set||!descriptor.get)continue;const key=Object.prototype.hasOwnProperty.call(type.prototype,"src")?"src":"href";Object.defineProperty(type.prototype,key,{configurable:descriptor.configurable,enumerable:descriptor.enumerable,get:descriptor.get,set(value){return descriptor.set.call(this,resolve(value)||value)}})}})();</script>`;
}

function createDocumentReadyBridge(token) {
  return `<script>window.addEventListener("load",()=>parent.postMessage({source:"gamesphere-local-game",token:${JSON.stringify(token)},type:"document-ready"},"*"),{once:true});</script>`;
}

function loadInitialGDevelopLocalStorage(namespace) {
  let timeout;
  const storageRequest = handleGDevelopStorageRequest({
    namespace,
    operation: "list-values",
    databaseName: "gamesphere-gdevelop-local-storage",
    objectStoreName: "local-storage"
  }, namespace);
  const timeoutRequest = new Promise((resolve, reject) => {
    timeout = window.setTimeout(
      () => reject(new Error("Loading saved game data took too long.")),
      GDEVELOP_STORAGE_PREFETCH_TIMEOUT_MS
    );
  });
  return Promise.race([storageRequest, timeoutRequest])
    .finally(() => window.clearTimeout(timeout));
}

async function createGameDocument(
  entryPath,
  files,
  progressToken,
  storageNamespace,
  onPreparationProgress,
  onPreparationStage
) {
  const entry = files.get(entryPath);
  if (!entry) throw new Error("The game's entry page could not be read.");

  const html = new TextDecoder().decode(entry);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("base").forEach(base => base.remove());

  const base = parsed.createElement("base");
  base.href = `https://gamesphere-local.invalid/${entryPath.split("/").map(encodeURIComponent).join("/")}`;
  parsed.head.prepend(base);

  const startupScript = [...parsed.querySelectorAll("script:not([src])")]
    .find(script => /loadAllAssets/.test(script.textContent) && /startGameLoop/.test(script.textContent));
  const storageInitialization = startupScript
    ? loadInitialGDevelopLocalStorage(storageNamespace).then(
      savedEntries => ({ savedEntries }),
      error => ({ error })
    )
    : null;

  const fileUrls = new Map();
  const fileEntries = [...files];
  const totalResourceBytes = fileEntries.reduce((total, [, bytes]) => total + bytes.byteLength, 0);
  let preparedBytes = 0;
  await Promise.all(fileEntries.map(async ([path, bytes]) => {
    let lastLoadedBytes = 0;
    const dataUrl = await toDataUrl(path, bytes, loadedBytes => {
      preparedBytes += loadedBytes - lastLoadedBytes;
      lastLoadedBytes = loadedBytes;
      onPreparationProgress?.(preparedBytes, totalResourceBytes);
    });
    fileUrls.set(path, dataUrl);
  }));

  let initialLocalStorage = {};
  let storageInitializationError = "";
  if (startupScript) {
    onPreparationStage?.("Checking saved game data…");
    const storageResult = await storageInitialization;
    if (storageResult.error) {
      console.error("Could not load GDevelop localStorage saves:", storageResult.error);
      storageInitializationError = storageResult.error.message;
    } else {
      initialLocalStorage = Object.fromEntries(storageResult.savedEntries
        .filter(entry => typeof entry.key === "string" && typeof entry.value === "string")
        .map(entry => [entry.key, entry.value]));
    }
    const storageBridge = parsed.createElement("script");
    storageBridge.textContent = createGDevelopLocalStorageBridge(
      progressToken,
      storageNamespace,
      initialLocalStorage,
      storageInitializationError
    );
    const firstHeadScript = parsed.head.querySelector("script");
    if (firstHeadScript) {
      parsed.head.insertBefore(storageBridge, firstHeadScript);
    } else {
      parsed.head.append(storageBridge);
    }
    startupScript.textContent = `${createGDevelopStorageBridge()}\n${createGDevelopProgressBridge(progressToken)}\n${startupScript.textContent}`;
  }

  parsed.querySelectorAll("link[rel~='stylesheet'][href]").forEach(link => {
    const reference = link.getAttribute("href");
    const cssPath = resolveGameAssetPath(reference, entryPath);
    const cssFile = cssPath && files.get(cssPath);
    if (!cssFile) return;
    const style = parsed.createElement("style");
    style.textContent = rewriteCss(new TextDecoder().decode(cssFile), cssPath, fileUrls);
    link.replaceWith(style);
  });

  for (const attribute of ["src", "href", "poster", "data"]) {
    parsed.querySelectorAll(`[${attribute}]`).forEach(element => {
      const value = element.getAttribute(attribute);
      const assetPath = resolveGameAssetPath(value, entryPath);
      const mapped = assetPath && fileUrls.get(assetPath);
      if (mapped) {
        element.setAttribute(attribute, preserveSuffix(value, mapped));
      }
    });
  }
  parsed.querySelectorAll("*").forEach(element => {
    if (!element.hasAttributeNS("http://www.w3.org/1999/xlink", "href")) return;
    const reference = element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    const assetPath = resolveGameAssetPath(reference, entryPath);
    const mapped = assetPath && fileUrls.get(assetPath);
    if (mapped) {
      element.setAttributeNS(
        "http://www.w3.org/1999/xlink",
        "xlink:href",
        preserveSuffix(reference, mapped)
      );
    }
  });

  parsed.querySelectorAll("[srcset]").forEach(element => {
    const value = element.getAttribute("srcset");
    const rewritten = value.replace(/(^|,\s*)([^,\s]+)(\s+[^,]+)?/g, (match, prefix, reference, descriptor = "") => {
      const assetPath = resolveGameAssetPath(reference, entryPath);
      const mapped = assetPath && fileUrls.get(assetPath);
      return mapped ? `${prefix}${preserveSuffix(reference, mapped)}${descriptor}` : match;
    });
    element.setAttribute("srcset", rewritten);
  });

  parsed.querySelectorAll("style").forEach(style => {
    style.textContent = rewriteCss(style.textContent, entryPath, fileUrls);
  });
  parsed.querySelectorAll("[style]").forEach(element => {
    element.setAttribute("style", rewriteCss(element.getAttribute("style"), entryPath, fileUrls));
  });

  const policy = parsed.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src data: blob: https: 'unsafe-inline' 'unsafe-eval'; img-src data: blob: https:; media-src data: blob: https:; font-src data: blob: https:; style-src data: blob: https: 'unsafe-inline'; script-src data: blob: https: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src data: blob: https: wss:; worker-src data: blob: https:; frame-src data: blob: https:; form-action https:";
  parsed.head.prepend(policy);
  base.after(parsed.createRange().createContextualFragment(
    `${createRuntimeBridge(Object.fromEntries(fileUrls))}${createDocumentReadyBridge(progressToken)}`
  ));
  return {
    html: `<!doctype html>\n${parsed.documentElement.outerHTML}`,
    tracksProgress: Boolean(startupScript)
  };
}

async function readZipBytes(file) {
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_LOCAL_ZIP_BYTES) {
    throw new Error("Choose a non-empty game ZIP no larger than 10 MB.");
  }
  return new Uint8Array(await file.arrayBuffer());
}

async function readHtmlBytes(file) {
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_LOCAL_ZIP_BYTES) {
    throw new Error("Choose a non-empty HTML file no larger than 10 MB.");
  }
  return new Uint8Array(await file.arrayBuffer());
}

function initLocalGamePlayer() {
  const fileInput = document.getElementById("game-zip-input");
  const htmlInput = document.getElementById("game-html-input");
  const playButton = document.getElementById("local-play-button");
  const modal = document.getElementById("local-game-modal");
  const frame = document.getElementById("local-game-frame");
  const title = document.getElementById("local-game-title");
  const closeButton = document.getElementById("local-game-close");
  const fullscreenButton = document.getElementById("local-game-fullscreen");
  const loading = document.getElementById("local-game-loading");
  const loadingTitle = document.getElementById("local-game-loading-title");
  const loadingPercent = document.getElementById("local-game-loading-percent");
  const loadingTrack = document.getElementById("local-game-loading-track");
  const loadingProgress = document.getElementById("local-game-loading-progress");
  const loadingMessage = document.getElementById("local-game-loading-message");
  if (!fileInput || !htmlInput || !playButton || !modal || !frame || !title || !closeButton || !fullscreenButton ||
      !loading || !loadingTitle || !loadingPercent || !loadingTrack ||
      !loadingProgress || !loadingMessage) return;

  let activeToken = null;
  let activeStorageNamespace = null;
  let storageErrorReported = false;
  const storageOperations = new Set();
  let lastStorageActivity = 0;
  let isClosing = false;
  let tracksProgress = false;

  function updateFullscreenButton() {
    const isFullscreen = document.fullscreenElement === frame;
    fullscreenButton.textContent = isFullscreen ? "⛶ Exit full screen" : "⛶ Full screen";
    fullscreenButton.setAttribute("aria-label", isFullscreen ? "Exit full screen" : "Enter full screen");
    fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === frame) {
        await document.exitFullscreen();
      } else {
        if (typeof frame.requestFullscreen !== "function") {
          throw new Error("Fullscreen is not supported by this browser.");
        }
        await frame.requestFullscreen();
      }
      updateFullscreenButton();
    } catch (error) {
      console.error("Could not change game fullscreen state:", error);
      window.GameSphereShowToast?.(`Could not change full screen: ${error.message}`);
    }
  }

  function updateProgress(percent, message) {
    const safePercent = Math.max(0, Math.min(100, Math.floor(percent)));
    loadingPercent.textContent = `${safePercent}%`;
    loadingTrack.setAttribute("aria-valuenow", String(safePercent));
    loadingProgress.style.width = `${safePercent}%`;
    loadingMessage.textContent = message;
    loadingMessage.classList.remove("game-loading-error");
  }

  function finishLoading() {
    updateProgress(100, "Game resources loaded. Starting game…");
    loading.hidden = true;
  }

  function failLoading(message) {
    loadingTitle.textContent = "Game could not finish loading";
    loadingMessage.textContent = message;
    loadingMessage.classList.add("game-loading-error");
    loadingTrack.hidden = true;
    loadingPercent.hidden = true;
  }

  window.addEventListener("message", event => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== "gamesphere-local-game" ||
        data.token !== activeToken || typeof data.type !== "string") return;
    if (data.type === "storage-request") {
      if (!activeStorageNamespace || !Number.isSafeInteger(data.requestId)) return;
      lastStorageActivity = Date.now();
      const storageOperation = handleGDevelopStorageRequest(data, activeStorageNamespace);
      storageOperations.add(storageOperation);
      storageOperation
        .then(result => {
          frame.contentWindow.postMessage({
            source: "gamesphere-local-game",
            token: data.token,
            type: "storage-response",
            requestId: data.requestId,
            result
          }, "*");
        })
        .catch(error => {
          console.error("Could not access local GDevelop save storage:", error);
          if (!storageErrorReported) {
            storageErrorReported = true;
            window.GameSphereShowToast?.(`Game save storage is unavailable: ${error.message}`);
          }
          frame.contentWindow.postMessage({
            source: "gamesphere-local-game",
            token: data.token,
            type: "storage-response",
            requestId: data.requestId,
            error: error.message
          }, "*");
        })
        .finally(() => storageOperations.delete(storageOperation));
    } else if (data.type === "storage-error") {
      if (!storageErrorReported) {
        storageErrorReported = true;
        window.GameSphereShowToast?.(typeof data.message === "string"
          ? data.message
          : "Game save storage is unavailable.");
      }
    } else if (data.type === "progress" && Number.isFinite(data.percent)) {
      updateProgress(data.percent, typeof data.message === "string"
        ? data.message
        : "Loading game resources and extensions…");
    } else if (data.type === "complete") {
      finishLoading();
    } else if (data.type === "document-ready") {
      if (tracksProgress) {
        loadingMessage.textContent = "Loading game resources and extensions…";
      } else {
        finishLoading();
      }
    } else if (data.type === "error") {
      const message = typeof data.message === "string"
        ? data.message
        : "A game resource failed to load.";
      if (loading.hidden) {
        window.GameSphereShowToast?.(`Game startup extension failed: ${message}`);
      } else {
        failLoading(message);
      }
    }
  });

  async function playGameFile(file, isHtmlFile) {
    if (playButton.disabled) return;
    const token = window.crypto.randomUUID();
    activeToken = token;
    playButton.disabled = true;
    playButton.textContent = "Preparing game…";
    title.textContent = file.name.replace(/\.[^.]+$/, "") || "Game";
    loading.hidden = false;
    loadingTitle.textContent = "Preparing game";
    loadingTrack.hidden = false;
    loadingPercent.hidden = false;
    updateProgress(0, "Reading the selected game ZIP…");
    modal.hidden = false;
    document.body.classList.add("local-game-open");
    try {
      let entryPath;
      let files;
      let gameBytes;
      if (isHtmlFile) {
        updateProgress(0, "Reading the selected HTML file…");
        gameBytes = await readHtmlBytes(file);
        const html = new TextDecoder("utf-8", { fatal: true }).decode(gameBytes);
        entryPath = file.name;
        files = new Map([[entryPath, new TextEncoder().encode(html)]]);
      } else {
        updateProgress(0, "Reading the selected game ZIP…");
        gameBytes = await readZipBytes(file);
        updateProgress(0, "Extracting game files…");
        ({ entryPath, files } = await unpackLocalGameAsync(gameBytes));
      }
      const storageNamespace = await createGameStorageNamespace(gameBytes);
      updateProgress(0, "Preparing game resources…");
      let lastPreparationPercent = -1;
      const gameDocument = await createGameDocument(
        entryPath,
        files,
        token,
        storageNamespace,
        (preparedBytes, totalResourceBytes) => {
          const progress = Math.floor(preparedBytes / totalResourceBytes * 75);
          if (progress === lastPreparationPercent && preparedBytes !== totalResourceBytes) return;
          lastPreparationPercent = progress;
          const loadedKilobytes = Math.floor(preparedBytes / 1024);
          const totalKilobytes = Math.ceil(totalResourceBytes / 1024);
          updateProgress(progress, `Preparing game resources… ${loadedKilobytes}/${totalKilobytes} KB`);
        },
        message => {
          updateProgress(75, message);
        }
      );
      tracksProgress = gameDocument.tracksProgress;
      activeStorageNamespace = storageNamespace;
      storageErrorReported = false;
      loadingTitle.textContent = tracksProgress
        ? "Loading game resources"
        : "Starting game";
      loadingMessage.textContent = tracksProgress
        ? "Waiting for the game resource loader…"
        : "Opening the game…";
      frame.srcdoc = gameDocument.html;
      closeButton.focus();
    } catch (error) {
      activeStorageNamespace = null;
      console.error("Could not launch local game:", error);
      failLoading(`Could not open this game: ${error.message}`);
    } finally {
      playButton.disabled = false;
      playButton.textContent = "Play locally";
    }
  }

  window.GameSphereLocalGames = Object.freeze({
    isAvailable: true,
    playZip(file) {
      if (!(file instanceof File) || !/\.zip$/i.test(file.name)) {
        return Promise.reject(new Error("Choose a saved game ZIP first."));
      }
      return playGameFile(file, false);
    }
  });

  playButton.addEventListener("click", () => {
    const htmlFile = htmlInput.files?.[0];
    const zipFile = fileInput.files?.[0];
    const file = htmlFile || zipFile;
    if (!file) {
      window.GameSphereShowToast?.("Choose a game HTML or ZIP file first.");
      return;
    }
    playGameFile(file, Boolean(htmlFile));
  });

  async function closeGame() {
    if (isClosing) return;
    isClosing = true;
    const closeButtonLabel = closeButton.textContent;
    closeButton.disabled = true;
    closeButton.textContent = "Saving…";
    const flushStarted = Date.now();
    lastStorageActivity = Date.now();
    do {
      await new Promise(resolve => window.setTimeout(resolve, 25));
      const pending = [...storageOperations];
      if (pending.length) await Promise.allSettled(pending);
    } while (Date.now() - lastStorageActivity < 75 && Date.now() - flushStarted < 2000);

    activeToken = null;
    activeStorageNamespace = null;
    modal.hidden = true;
    frame.srcdoc = "";
    loading.hidden = false;
    loadingTrack.hidden = false;
    loadingPercent.hidden = false;
    loadingTitle.textContent = "Loading game";
    updateProgress(0, "Preparing game ZIP…");
    document.body.classList.remove("local-game-open");
    closeButton.disabled = false;
    closeButton.textContent = closeButtonLabel;
    isClosing = false;
    playButton.focus();
  }

  closeButton.addEventListener("click", closeGame);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenButton);
  modal.addEventListener("click", event => {
    if (event.target === modal) closeGame();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || modal.hidden) return;
    if (document.fullscreenElement === frame) {
      event.preventDefault();
      document.exitFullscreen().catch(error => {
        console.error("Could not exit game fullscreen:", error);
        window.GameSphereShowToast?.(`Could not exit full screen: ${error.message}`);
      }).then(updateFullscreenButton);
    } else {
      closeGame();
    }
  });
  updateFullscreenButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLocalGamePlayer, { once: true });
} else {
  initLocalGamePlayer();
}
