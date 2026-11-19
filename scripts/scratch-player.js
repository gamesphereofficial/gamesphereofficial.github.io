function initScratchPlayer() {
  const fileInput = document.getElementById("scratch-file-input");
  const playButton = document.getElementById("scratch-play-button");
  const uploadStatus = document.getElementById("scratch-upload-status");
  const modal = document.getElementById("scratch-game-modal");
  const title = document.getElementById("scratch-game-title");
  const playerStatus = document.getElementById("scratch-player-status");
  const canvas = document.getElementById("scratch-game-canvas");
  const closeButton = document.getElementById("scratch-game-close");
  const fullscreenButton = document.getElementById("scratch-game-fullscreen");
  const flagButton = document.getElementById("scratch-game-flag");
  const stopButton = document.getElementById("scratch-game-stop");
  if (!fileInput || !playButton || !modal || !canvas) return;

  let runtimeLoadPromise;
  let projectLoadId = 0;

  function setStatus(message) {
    playerStatus.textContent = message;
  }

  function loadRuntime() {
    if (window.GameSphereScratchRuntime) return Promise.resolve(window.GameSphereScratchRuntime);
    if (runtimeLoadPromise) return runtimeLoadPromise;

    runtimeLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("./scratch-runtime.js", window.location.href).href;
      script.onload = () => {
        if (window.GameSphereScratchRuntime?.playScratchProject) {
          resolve(window.GameSphereScratchRuntime);
        } else {
          reject(new Error("The Scratch runtime did not initialize correctly."));
        }
      };
      script.onerror = () => reject(new Error("Could not load the Scratch runtime. Check your internet connection and refresh the page."));
      document.head.append(script);
    }).catch(error => {
      runtimeLoadPromise = null;
      throw error;
    });
    return runtimeLoadPromise;
  }

  function closePlayer() {
    projectLoadId += 1;
    window.GameSphereScratchRuntime?.stopScratchProject();
    modal.hidden = true;
    document.body.classList.remove("local-game-open");
    canvas.width = 480;
    canvas.height = 360;
    if (document.fullscreenElement === modal.querySelector(".game-modal-panel")) {
      document.exitFullscreen().catch(error => console.error("Could not exit Scratch full screen:", error));
    }
    playButton.focus();
  }

  async function playProject(file) {
    if (!file) {
      uploadStatus.textContent = "Choose a Scratch .sb, .sb2, or .sb3 project first.";
      return;
    }
    if (!/\.sb[123]?$/i.test(file.name) || file.size > 50 * 1024 * 1024) {
      uploadStatus.textContent = "Choose a Scratch .sb, .sb2, or .sb3 file smaller than 50 MB.";
      return;
    }

    const loadId = ++projectLoadId;
    playButton.disabled = true;
    uploadStatus.textContent = "Opening the Scratch player…";
    title.textContent = file.name.replace(/\.sb[123]?$/i, "").slice(0, 100) || "Scratch project";
    modal.hidden = false;
    document.body.classList.add("local-game-open");
    setStatus("Loading the Scratch runtime on demand…");
    closeButton.focus();

    try {
      const runtime = await loadRuntime();
      const buffer = await file.arrayBuffer();
      if (loadId !== projectLoadId) return;
      await runtime.playScratchProject(buffer, canvas, setStatus);
      if (loadId !== projectLoadId) return;
      uploadStatus.textContent = "Scratch project loaded locally in your browser.";
    } catch (error) {
      if (loadId !== projectLoadId) return;
      console.error("Could not play Scratch project:", error);
      uploadStatus.textContent = error.message || "Could not load this Scratch project.";
      setStatus(error.message || "Could not load this Scratch project.");
    } finally {
      if (loadId === projectLoadId) playButton.disabled = false;
    }
  }

  playButton.addEventListener("click", () => playProject(fileInput.files?.[0]));
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) uploadStatus.textContent = `${file.name} selected.`;
  });
  flagButton.addEventListener("click", () => window.GameSphereScratchRuntime?.greenFlagScratchProject());
  stopButton.addEventListener("click", () => window.GameSphereScratchRuntime?.stopAllScratchScripts());
  closeButton.addEventListener("click", closePlayer);
  fullscreenButton.addEventListener("click", () => {
    const panel = modal.querySelector(".game-modal-panel");
    const operation = document.fullscreenElement === panel
      ? document.exitFullscreen?.()
      : panel.requestFullscreen?.();
    operation?.catch(error => {
      console.error("Could not change Scratch full screen:", error);
      setStatus(`Could not change full screen: ${error.message}`);
    });
  });
  modal.addEventListener("click", event => {
    if (event.target === modal) closePlayer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.hidden) closePlayer();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScratchPlayer, { once: true });
} else {
  initScratchPlayer();
}
