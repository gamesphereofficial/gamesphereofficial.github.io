import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { validateScratchProject } from "./scratch-project.js";

function scratchArchive(project) {
  return zipSync({ "project.json": strToU8(JSON.stringify(project)) }).buffer;
}

test("accepts a Scratch project using built-in extensions", () => {
  const project = { targets: [], extensions: ["pen"] };
  assert.deepEqual(validateScratchProject(scratchArchive(project)), project);
});

test("rejects custom extension URLs before starting the Scratch VM", () => {
  assert.throws(
    () => validateScratchProject(scratchArchive({ targets: [], extensionURLs: { custom: "https://example.invalid/ext.js" } })),
    /custom extension URLs/
  );
});

test("rejects extensions that are not bundled in the local player", () => {
  assert.throws(
    () => validateScratchProject(scratchArchive({ targets: [], extensions: ["customExtension"] })),
    /unsupported or external extension/
  );
});
