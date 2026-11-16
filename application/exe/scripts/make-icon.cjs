const fs = require("node:fs");
const path = require("node:path");
const { deflateSync } = require("node:zlib");

const size = 256;
const pixels = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const offset = (y * size + x) * 4;
    const mix = (x + y) / (2 * (size - 1));
    pixels[offset] = Math.round(167 - 66 * mix);
    pixels[offset + 1] = Math.round(122 - 40 * mix);
    pixels[offset + 2] = Math.round(255 - 18 * mix);
    pixels[offset + 3] = 255;

    const dx = Math.abs(x - (size - 1) / 2);
    const dy = Math.abs(y - (size - 1) / 2);
    if (dx + dy < size * 0.28 && dx + dy > size * 0.17) {
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const scanlines = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) {
  const row = y * (size * 4 + 1);
  scanlines[row] = 0;
  pixels.copy(scanlines, row + 1, y * size * 4, (y + 1) * size * 4);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", header),
  pngChunk("IDAT", deflateSync(scanlines)),
  pngChunk("IEND", Buffer.alloc(0))
]);

const iconHeader = Buffer.alloc(6);
iconHeader.writeUInt16LE(0, 0);
iconHeader.writeUInt16LE(1, 2);
iconHeader.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = size === 256 ? 0 : size;
entry[1] = size === 256 ? 0 : size;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(iconHeader.length + entry.length, 12);

const iconPath = path.join(__dirname, "..", "assets", "icon.ico");
fs.mkdirSync(path.dirname(iconPath), { recursive: true });
fs.writeFileSync(iconPath, Buffer.concat([iconHeader, entry, png]));
console.log(`Generated GameSphere icon at ${iconPath}.`);
