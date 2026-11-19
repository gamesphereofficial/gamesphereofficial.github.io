import { strFromU8, unzipSync } from "fflate";

const SAFE_EXTENSION_IDS = new Set([
  "boost",
  "ev3",
  "gdxfor",
  "makeymakey",
  "microbit",
  "music",
  "pen",
  "text2speech",
  "translate",
  "videoSensing",
  "wedo2"
]);

export function validateScratchProject(buffer) {
  if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength) {
    throw new Error("The selected Scratch project file is empty.");
  }

  let project;
  try {
    const files = unzipSync(new Uint8Array(buffer));
    const projectJson = files["project.json"];
    if (!projectJson) throw new Error("missing project.json");
    project = JSON.parse(strFromU8(projectJson));
  } catch {
    throw new Error("This is not a valid Scratch project archive.");
  }

  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new Error("The Scratch project data is invalid.");
  }
  if (project.extensionURLs && Object.keys(project.extensionURLs).length) {
    throw new Error("Scratch projects that load custom extension URLs are not supported.");
  }
  if (project.extensions !== undefined &&
      (!Array.isArray(project.extensions) ||
       project.extensions.some(extension => typeof extension !== "string" || !SAFE_EXTENSION_IDS.has(extension)))) {
    throw new Error("This Scratch project uses an unsupported or external extension.");
  }
  return project;
}
