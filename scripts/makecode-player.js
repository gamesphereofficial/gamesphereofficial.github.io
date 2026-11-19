import { extractMakeCodeProjectFromHex, getMakeCodeProjectId } from "./makecode-project.js";

const MAKECODE_ORIGIN = "https://arcade.makecode.com";
const SIMULATOR_ORIGIN = "https://trg-arcade.userpxt.io";
const SIMULATOR_URL = `${SIMULATOR_ORIGIN}/---simulator`;
const CONTROLS_KEY = "gamesphere.makecode.keyboard-controls";
const BUTTONS = Object.freeze({
  A: 0,
  B: 1,
  Up: 2,
  Down: 3,
  Left: 4,
  Right: 5,
  Menu: 6,
  Reset: 7
});
const CONTROL_NAMES = Object.freeze({
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  a: "A",
  b: "B",
  menu: "Menu",
  reset: "Reset"
});
const DEFAULT_CONTROLS = Object.freeze({
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  a: "KeyZ",
  b: "KeyX",
  menu: "Enter",
  reset: "KeyR"
});

function readControls() {
  try {
    const stored = JSON.parse(localStorage.getItem(CONTROLS_KEY));
    if (!stored || typeof stored !== "object") return { ...DEFAULT_CONTROLS };
    const controls = { ...DEFAULT_CONTROLS, ...stored };
    const values = Object.values(controls);
    return Object.keys(CONTROL_NAMES).every(key => typeof controls[key] === "string") &&
      new Set(values).size === values.length
      ? controls
      : { ...DEFAULT_CONTROLS };
  } catch {
    return { ...DEFAULT_CONTROLS };
  }
}

function displayKey(code) {
  return ({
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Enter: "Enter",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    Space: "Space",
    Escape: "Escape"
  })[code] || code.replace(/^Key/, "").replace(/^Digit/, "");
}

function initMakeCodePlayer() {
  const input = document.getElementById("makecode-share-url");
  const hexInput = document.getElementById("makecode-hex-input");
  const playButton = document.getElementById("makecode-play-button");
  const status = document.getElementById("makecode-upload-status");
  const modal = document.getElementById("makecode-game-modal");
  const title = document.getElementById("makecode-game-title");
  const stage = document.getElementById("makecode-game-stage");
  const closeButton = document.getElementById("makecode-game-close");
  const fullscreenButton = document.getElementById("makecode-game-fullscreen");
  const playerStatus = document.getElementById("makecode-player-status");
  const controlButtons = [...document.querySelectorAll("[data-makecode-control]")];
  if (!input || !hexInput || !playButton || !modal || !stage) return;

  let controls = readControls();
  let activeControlButton = null;
  let compileFrame = null;
  let simulatorFrame = null;
  let pendingCompileTimeout = 0;
  let isReady = false;
  let lastRunCode = "";
  const pressedButtons = new Set();
  const keyToAction = new Map();

  function updateControlButtons() {
    keyToAction.clear();
    for (const [action, code] of Object.entries(controls)) {
      keyToAction.set(code, action);
    }
    for (const button of controlButtons) {
      const action = button.dataset.makecodeControl;
      button.textContent = displayKey(controls[action]);
    }
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function setPlayerStatus(message) {
    playerStatus.textContent = message;
  }

  function sendButtonState(button, pressed) {
    if (!isReady || !simulatorFrame?.contentWindow) return;
    simulatorFrame.contentWindow.postMessage(
      { type: "button-pressed", button, pressed },
      SIMULATOR_ORIGIN
    );
  }

  function releaseAllButtons() {
    for (const button of pressedButtons) sendButtonState(button, false);
    pressedButtons.clear();
  }

  function stopFrames() {
    window.clearTimeout(pendingCompileTimeout);
    releaseAllButtons();
    isReady = false;
    if (activeControlButton) {
      activeControlButton.textContent = displayKey(controls[activeControlButton.dataset.makecodeControl]);
    }
    activeControlButton = null;
    compileFrame?.remove();
    simulatorFrame?.remove();
    compileFrame = null;
    simulatorFrame = null;
    lastRunCode = "";
  }

  function startSimulator(code) {
    if (typeof code !== "string" || !code || code.length > 10 * 1024 * 1024) {
      throw new Error("MakeCode returned an invalid or oversized simulator program.");
    }

    lastRunCode = code;
    compileFrame?.remove();
    compileFrame = null;
    setPlayerStatus("Starting the Arcade simulator…");
    simulatorFrame = document.createElement("iframe");
    simulatorFrame.className = "makecode-simulator-frame";
    simulatorFrame.title = "MakeCode Arcade game";
    simulatorFrame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
    simulatorFrame.setAttribute("allow", "autoplay; gamepad");
    const frameId = `gamesphere-${Date.now()}`;
    simulatorFrame.id = frameId;
    simulatorFrame.src = `${SIMULATOR_URL}?justscreen=1&run=${frameId}#${frameId}`;
    stage.append(simulatorFrame);
    stage.setAttribute("aria-label", "MakeCode Arcade game. Focus this area to use the configured keyboard controls.");
  }

  function openCompiler(projectId, showCompiler = false) {
    stopFrames();
    modal.hidden = false;
    document.body.classList.add("local-game-open");
    stage.focus();
    setPlayerStatus(showCompiler
      ? "Compiling the HEX project in MakeCode Arcade. Use the simulator's default keyboard controls."
      : "Loading MakeCode Arcade…");
    compileFrame = document.createElement("iframe");
    compileFrame.className = showCompiler ? "makecode-source-frame" : "makecode-compiler-frame";
    compileFrame.title = "MakeCode Arcade compiler";
    compileFrame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    if (showCompiler) {
      compileFrame.setAttribute("allow", "autoplay; fullscreen; gamepad");
      stage.setAttribute("aria-label", "MakeCode Arcade game. Use the default controls in the embedded MakeCode simulator.");
    }
    compileFrame.src = projectId
      ? `${MAKECODE_ORIGIN}/--run?id=${encodeURIComponent(projectId)}&sendBuilt=1&fullscreen=1&nofooter=1&single=1`
      : `${MAKECODE_ORIGIN}/--run?server=1&sendBuilt=1&fullscreen=1&nofooter=1&single=1`;
    stage.append(compileFrame);
    if (!showCompiler) {
      pendingCompileTimeout = window.setTimeout(() => {
        if (modal.hidden || !compileFrame) return;
        setPlayerStatus("MakeCode is taking longer than expected. Check your internet connection and try again.");
      }, 30000);
    }
  }

  function closePlayer() {
    stopFrames();
    modal.hidden = true;
    document.body.classList.remove("local-game-open");
    if (document.fullscreenElement === stage) {
      document.exitFullscreen().catch(error => {
        console.error("Could not exit MakeCode full screen:", error);
      });
    }
    playButton.focus();
  }

  function toggleFullscreen() {
    const operation = document.fullscreenElement === stage
      ? document.exitFullscreen()
      : stage.requestFullscreen();
    operation?.catch(error => {
      console.error("Could not change MakeCode full screen:", error);
      setPlayerStatus(`Could not change full screen: ${error.message}`);
    });
  }

  function mapKey(event, pressed) {
    if (modal.hidden || activeControlButton || event.repeat) return;
    const action = keyToAction.get(event.code);
    if (!action) return;
    event.preventDefault();
    const button = BUTTONS[CONTROL_NAMES[action]];
    if (pressed) {
      if (pressedButtons.has(button)) return;
      pressedButtons.add(button);
    } else {
      if (!pressedButtons.delete(button)) return;
    }
    sendButtonState(button, pressed);
  }

  for (const button of controlButtons) {
    button.addEventListener("click", () => {
      if (activeControlButton) {
        activeControlButton.textContent = displayKey(controls[activeControlButton.dataset.makecodeControl]);
      }
      activeControlButton = button;
      button.textContent = "Press key";
    });
  }

  document.addEventListener("keydown", event => {
    if (activeControlButton) {
      event.preventDefault();
      const action = activeControlButton.dataset.makecodeControl;
      const duplicate = Object.entries(controls).some(([key, code]) => key !== action && code === event.code);
      if (duplicate) {
        setStatus("Each MakeCode action needs a different key.");
        activeControlButton.textContent = displayKey(controls[action]);
        activeControlButton = null;
        return;
      }
      controls[action] = event.code;
      let saved = true;
      try {
        localStorage.setItem(CONTROLS_KEY, JSON.stringify(controls));
      } catch (error) {
        saved = false;
        console.error("Could not save MakeCode keyboard controls:", error);
      }
      activeControlButton.textContent = displayKey(event.code);
      activeControlButton = null;
      updateControlButtons();
      setStatus(saved
        ? "Keyboard controls saved on this device."
        : "The browser could not save these controls. They will work until this page is closed.");
      return;
    }
    mapKey(event, true);
  });
  document.addEventListener("keyup", event => mapKey(event, false));
  window.addEventListener("blur", releaseAllButtons);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAllButtons();
  });

  window.addEventListener("message", event => {
    if (!compileFrame || event.source !== compileFrame.contentWindow || event.origin !== MAKECODE_ORIGIN) return;
    if (typeof event.data?.js !== "string") return;
    try {
      window.clearTimeout(pendingCompileTimeout);
      startSimulator(event.data.js);
    } catch (error) {
      console.error("Could not start MakeCode game:", error);
      setPlayerStatus(error.message);
    }
  });

  window.addEventListener("message", event => {
    if (!simulatorFrame || event.source !== simulatorFrame.contentWindow || event.origin !== SIMULATOR_ORIGIN) return;
    if (event.data?.type === "ready") {
      isReady = true;
      simulatorFrame.contentWindow.postMessage({ type: "run", code: lastRunCode }, SIMULATOR_ORIGIN);
      setPlayerStatus("Game ready. Click the game area, then use the keys shown below.");
      setStatus("MakeCode game loaded. Use the keyboard bindings above to play.");
    } else if (event.data?.type === "simulator" && event.data.command === "restart" && lastRunCode) {
      simulatorFrame.contentWindow.postMessage({ type: "run", code: lastRunCode }, SIMULATOR_ORIGIN);
    }
  });

  stage.addEventListener("pointerdown", () => stage.focus());
  closeButton.addEventListener("click", closePlayer);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  modal.addEventListener("click", event => {
    if (event.target === modal) closePlayer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.hidden) closePlayer();
  });
  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.textContent = document.fullscreenElement === stage ? "Exit full screen" : "⛶ Full screen";
  });

  playButton.addEventListener("click", async () => {
    const hexFile = hexInput.files?.[0];
    const shareUrl = input.value.trim();
    if (!hexFile && !shareUrl) {
      setStatus("Paste a public MakeCode Arcade share link or choose a source-enabled HEX file.");
      return;
    }

    playButton.disabled = true;
    setStatus(hexFile ? "Reading MakeCode HEX source in this browser…" : "Loading public MakeCode project…");
    try {
      if (hexFile) {
        if (!/\.hex$/i.test(hexFile.name) || hexFile.size > 2 * 1024 * 1024) {
          throw new Error("Choose a MakeCode Arcade HEX file under 2 MB. UF2 firmware files cannot run in a browser.");
        }
        const text = await hexFile.text();
        const lzma = window.LZMA?.("./lzma_worker-min.js");
        if (!lzma) throw new Error("The MakeCode HEX source decoder did not load. Refresh the page and try again.");
        const project = await extractMakeCodeProjectFromHex(text, compressed =>
          new Promise((resolve, reject) => {
            const worker = lzma.worker?.();
            const timeout = window.setTimeout(() => {
              worker?.terminate();
              reject(new Error("MakeCode HEX source decoding timed out."));
            }, 20000);
            lzma.decompress(Array.from(compressed, byte => byte > 127 ? byte - 256 : byte), (result, error) => {
              window.clearTimeout(timeout);
              worker?.terminate();
              if (error) reject(error);
              else resolve(result);
            });
          })
        );
        title.textContent = hexFile.name.replace(/\.hex$/i, "");
        setStatus("Project source extracted locally. Starting MakeCode compiler…");
        openCompiler(null, true);
        compileFrame.addEventListener("load", () => {
          if (!compileFrame?.contentWindow || modal.hidden) return;
          setStatus("MakeCode is compiling this HEX project. Use the embedded simulator's built-in controls.");
          compileFrame.contentWindow.postMessage(
            { type: "simulateproject", project: project.files },
            MAKECODE_ORIGIN
          );
        }, { once: true });
      } else {
        const projectId = getMakeCodeProjectId(shareUrl);
        title.textContent = `MakeCode Arcade · ${projectId}`;
        setStatus("Loading public MakeCode project…");
        openCompiler(projectId);
      }
      closeButton.focus();
    } catch (error) {
      console.error("Could not load MakeCode project:", error);
      setStatus(error.message || "Could not load this MakeCode project.");
    } finally {
      playButton.disabled = false;
    }
  });

  updateControlButtons();
  setStatus("Use a public share link or a MakeCode HEX export with embedded project source. UF2 files require compatible hardware.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMakeCodePlayer, { once: true });
} else {
  initMakeCodePlayer();
}
