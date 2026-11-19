import assert from "node:assert/strict";
import { test } from "node:test";
import { getRetroSystem, validateRetroFiles } from "./retro-game.js";

function file(name, contents = "rom data") {
  return {
    name,
    size: contents.length,
    text: async () => contents
  };
}

test("maps supported consoles to EmulatorJS cores", () => {
  assert.equal(getRetroSystem("n64").core, "n64");
  assert.equal(getRetroSystem("gbc").core, "gb");
  assert.equal(getRetroSystem("arcade").core, "arcade");
  assert.equal(getRetroSystem("psp").requiresThreads, true);
  assert.equal(getRetroSystem("unknown"), null);
});

test("accepts supported single-file ROM formats", async () => {
  assert.equal((await validateRetroFiles("n64", [file("game.z64")])).core, "n64");
  assert.equal((await validateRetroFiles("ps1", [file("game.pbp")])).core, "psx");
  assert.equal((await validateRetroFiles("arcade", [file("game.zip")])).core, "arcade");
});

test("requires a complete BIN+CUE bundle with safe, present track names", async () => {
  const validFiles = [
    file("disc.cue", 'FILE "track.bin" BINARY\n  TRACK 01 MODE1/2352\n'),
    file("track.bin")
  ];
  assert.equal((await validateRetroFiles("bin-cue", validFiles)).core, "psx");
  await assert.rejects(validateRetroFiles("bin-cue", [validFiles[0]]), /one CUE sheet/);
  await assert.rejects(
    validateRetroFiles("bin-cue", [file("disc.cue", 'FILE "../track.bin" BINARY'), validFiles[1]]),
    /filename only/
  );
  await assert.rejects(
    validateRetroFiles("bin-cue", [file("disc.cue", 'FILE "missing.bin" BINARY'), validFiles[1]]),
    /missing BIN/
  );
});

test("rejects mismatched extensions, multiple ROMs, and oversized files", async () => {
  await assert.rejects(validateRetroFiles("nes", [file("game.gba")]), /NES file/);
  await assert.rejects(validateRetroFiles("gba", [file("a.gba"), file("b.gba")]), /exactly one/);
  await assert.rejects(
    validateRetroFiles("nes", [{ name: "game.nes", size: 96 * 1024 * 1024 + 1 }]),
    /96 MB/
  );
});
