import assert from "node:assert/strict";
import { test } from "node:test";
import { compress, decompress } from "lzma";
import { extractMakeCodeProjectFromHex, getMakeCodeProjectId } from "./makecode-project.js";

function intelHexRecord(address, type, data) {
  const bytes = [data.length, address >> 8, address & 0xff, type, ...data];
  bytes.push((-bytes.reduce((sum, byte) => sum + byte, 0)) & 0xff);
  return `:${bytes.map(byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function makeSourceHex(source, metadata) {
  const compressed = Array.from(compress(source, 1), byte => byte & 0xff);
  const metadataBytes = Buffer.from(JSON.stringify(metadata));
  const payload = [
    0x41, 0x14, 0x0e, 0x2f, 0xb8, 0x2f, 0xa2, 0xbb,
    metadataBytes.length & 0xff,
    metadataBytes.length >> 8,
    compressed.length & 0xff,
    (compressed.length >> 8) & 0xff,
    (compressed.length >> 16) & 0xff,
    (compressed.length >> 24) & 0xff,
    0, 0,
    ...metadataBytes,
    ...compressed
  ];
  const records = [];
  for (let offset = 0; offset < payload.length; offset += 16) {
    records.push(intelHexRecord(offset, 0x0e, payload.slice(offset, offset + 16)));
  }
  records.push(intelHexRecord(0, 1, []));
  return records.join("\n");
}

test("extracts a valid MakeCode Arcade project from a source-enabled HEX", async () => {
  const files = {
    "pxt.json": JSON.stringify({ name: "test", dependencies: { core: "*" }, files: ["main.ts"] }),
    "main.ts": "game.splash('Ready');"
  };
  const embeddedHeader = JSON.stringify({ targetVersion: "1.0.0" });
  const source = embeddedHeader + JSON.stringify(files);
  const hex = makeSourceHex(source, {
    eURL: "https://arcade.makecode.com/",
    eVER: "1.0.0",
    compression: "LZMA",
    headerSize: embeddedHeader.length
  });

  const project = await extractMakeCodeProjectFromHex(hex, async bytes => decompress(Array.from(bytes)));
  assert.deepEqual(project.files, files);
  assert.equal(project.metadata.targetVersion, "1.0.0");
});

test("rejects HEX records with an invalid checksum", async () => {
  const malformed = ":1000000E41140E2FB82FA2BBA000FC7A00000000F7";
  await assert.rejects(
    extractMakeCodeProjectFromHex(malformed, async () => ""),
    /damaged record/
  );
});

test("rejects project links from other origins", () => {
  assert.throws(() => getMakeCodeProjectId("https://example.com/S47023-09562-70652-20436"), /arcade.makecode.com/);
});

test("extracts a project ID from the provided MakeCode share URL", () => {
  assert.equal(
    getMakeCodeProjectId("https://arcade.makecode.com/S47023-09562-70652-20436"),
    "S47023-09562-70652-20436"
  );
});
