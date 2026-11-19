import AudioEngine from "scratch-audio";
import ScratchRender from "../node_modules/scratch-render/src/RenderWebGL.js";
import { ScratchStorage } from "scratch-storage";
import VirtualMachine from "scratch-vm";
import { validateScratchProject } from "./scratch-project.js";

let vm;

export async function playScratchProject(buffer, canvas, onStatus) {
  stopScratchProject();
  validateScratchProject(buffer);
  onStatus("Preparing Scratch stage…");

  const renderer = new ScratchRender(canvas);
  renderer.setStageSize(-240, 240, -180, 180);
  const audioEngine = new AudioEngine();
  const storage = new ScratchStorage();
  storage.addWebStore(
    [storage.AssetType.ImageVector, storage.AssetType.ImageBitmap, storage.AssetType.Sound],
    asset => `https://assets.scratch.mit.edu/internalapi/asset/${asset.assetId}.${asset.dataFormat}/get/`
  );

  const activeVm = new VirtualMachine();
  vm = activeVm;
  activeVm.attachRenderer(renderer);
  activeVm.attachAudioEngine(audioEngine);
  activeVm.attachStorage(storage);
  activeVm.setCompatibilityMode(true);
  activeVm.start();

  try {
    await activeVm.loadProject(buffer);
    if (vm !== activeVm) return;
    activeVm.greenFlag();
    onStatus("Scratch project ready. Use the green flag or stop button above.");
  } catch (error) {
    if (vm === activeVm) stopScratchProject();
    throw new Error(`Could not load this Scratch project: ${error.message}`);
  }
}

export function greenFlagScratchProject() {
  vm?.greenFlag();
}

export function stopScratchProject() {
  if (!vm) return;
  vm.stopAll();
  vm.quit();
  vm = null;
}

export function stopAllScratchScripts() {
  vm?.stopAll();
}
