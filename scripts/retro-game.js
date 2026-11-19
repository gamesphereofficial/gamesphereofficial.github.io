export const RETRO_SYSTEMS = Object.freeze({
  n64: { label: "Nintendo 64", core: "n64", extensions: [".n64", ".v64", ".z64"] },
  ps1: { label: "PlayStation (PBP)", core: "psx", extensions: [".pbp"] },
  psp: { label: "PSP (PBP)", core: "psp", extensions: [".pbp"], requiresThreads: true },
  nes: { label: "NES", core: "nes", extensions: [".nes"] },
  gba: { label: "Game Boy Advance", core: "gba", extensions: [".gba"] },
  gbc: { label: "Game Boy Color", core: "gb", extensions: [".gbc"] },
  gb: { label: "Game Boy", core: "gb", extensions: [".gb"] },
  snes: { label: "SNES / SFC", core: "snes", extensions: [".smc", ".sfc"] },
  arcade: { label: "FBA / FBNeo arcade", core: "arcade", extensions: [".zip"] },
  "bin-cue": { label: "PlayStation BIN + CUE", core: "psx", extensions: [".bin", ".cue"] }
});

export const MAX_RETRO_FILE_BYTES = 96 * 1024 * 1024;
const MAX_CUE_BYTES = 1024 * 1024;

export async function validateRetroFiles(systemId, files) {
  const system = RETRO_SYSTEMS[systemId];
  if (!system) throw new Error("Choose a supported game system.");
  if (!Array.isArray(files) || files.length === 0) throw new Error("Choose a game file.");
  if (files.some(file => !file || typeof file.name !== "string" || !Number.isFinite(file.size))) {
    throw new Error("The selected game files are invalid.");
  }
  if (files.some(file => file.size === 0 || file.size > MAX_RETRO_FILE_BYTES)) {
    throw new Error("Each game file must be between 1 byte and 96 MB.");
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_RETRO_FILE_BYTES) {
    throw new Error("The complete game bundle must be 96 MB or smaller.");
  }
  if (new Set(files.map(file => file.name.toLowerCase())).size !== files.length) {
    throw new Error("The selected game files contain duplicate filenames.");
  }

  if (systemId !== "bin-cue" && files.length !== 1) {
    throw new Error("Choose exactly one file for this system.");
  }
  if (systemId !== "bin-cue" &&
      !system.extensions.some(extension => files[0].name.toLowerCase().endsWith(extension))) {
    throw new Error(`Choose a ${system.label} file (${system.extensions.join(", ")}).`);
  }
  if (systemId === "bin-cue") {
    const cueFiles = files.filter(file => file.name.toLowerCase().endsWith(".cue"));
    const binFiles = files.filter(file => file.name.toLowerCase().endsWith(".bin"));
    if (cueFiles.length !== 1 || binFiles.length === 0 || cueFiles.length + binFiles.length !== files.length) {
      throw new Error("Choose one CUE sheet and all of its BIN track files.");
    }
    if (cueFiles[0].size > MAX_CUE_BYTES) {
      throw new Error("The CUE sheet must be 1 MB or smaller.");
    }
    const availableFiles = new Set(files.map(file => file.name.toLowerCase()));
    const cueText = await cueFiles[0].text();
    const trackPattern = /^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+\S+/gim;
    const referencedFiles = new Set();
    let match;
    while ((match = trackPattern.exec(cueText)) !== null) {
      const path = (match[1] || match[2]).replaceAll("\\", "/");
      if (path.includes("/") || path === "." || path === ".." || !path.toLowerCase().endsWith(".bin")) {
        throw new Error("The CUE sheet must reference BIN tracks by filename only.");
      }
      if (!availableFiles.has(path.toLowerCase())) {
        throw new Error(`The CUE sheet references a missing BIN file: ${path}`);
      }
      referencedFiles.add(path.toLowerCase());
    }
    if (referencedFiles.size === 0 || binFiles.some(file => !referencedFiles.has(file.name.toLowerCase()))) {
      throw new Error("The CUE sheet must reference every selected BIN track.");
    }
  }

  return system;
}

export function getRetroSystem(systemId) {
  return RETRO_SYSTEMS[systemId] || null;
}
