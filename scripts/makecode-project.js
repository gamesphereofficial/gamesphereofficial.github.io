const MAKECODE_ORIGIN = "https://arcade.makecode.com";
const HEX_MAX_CHARACTERS = 2 * 1024 * 1024;
const PROJECT_MAX_CHARACTERS = 8 * 1024 * 1024;
const PROJECT_MAX_FILES = 400;
const SOURCE_MAGIC = [0x41, 0x14, 0x0e, 0x2f, 0xb8, 0x2f, 0xa2, 0xbb];

export function getMakeCodeProjectId(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid MakeCode Arcade share link.");
  }

  if (url.origin !== MAKECODE_ORIGIN) {
    throw new Error("Use a public share link from arcade.makecode.com.");
  }

  const projectId = url.pathname.split("/").filter(Boolean).pop() || "";
  if (!/^S?[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(projectId)) {
    throw new Error("That link does not contain a valid MakeCode Arcade project ID.");
  }
  return projectId;
}

function parseHexRecords(text) {
  if (typeof text !== "string" || text.length > HEX_MAX_CHARACTERS) {
    throw new Error("The HEX file is too large to process in the browser.");
  }

  const records = [];
  let upperAddress = 0;
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!/^:[0-9a-f]{10,}$/i.test(line) || line.length % 2 !== 1) {
      throw new Error(`The HEX file has a malformed record on line ${index + 1}.`);
    }

    const bytes = [];
    for (let offset = 1; offset < line.length; offset += 2) {
      bytes.push(Number.parseInt(line.slice(offset, offset + 2), 16));
    }
    const count = bytes[0];
    if (bytes.length !== count + 5 || bytes.reduce((sum, byte) => sum + byte, 0) % 256 !== 0) {
      throw new Error(`The HEX file has a damaged record on line ${index + 1}.`);
    }

    const address = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const data = bytes.slice(4, -1);
    if (type === 0x04 && data.length === 2) {
      upperAddress = ((data[0] << 8) | data[1]) << 16;
    } else if (type === 0x02 && data.length === 2) {
      upperAddress = ((data[0] << 8) | data[1]) << 4;
    } else if (type === 0x0e) {
      records.push({ address: upperAddress + address, data });
    }
  }
  if (!records.length) {
    throw new Error("This HEX file has no embedded MakeCode source. Upload a MakeCode Arcade HEX export, not UF2 firmware.");
  }
  return records.sort((left, right) => left.address - right.address);
}

function sourceSegments(records) {
  const segments = [];
  for (const record of records) {
    let segment = segments[segments.length - 1];
    if (!segment || record.address !== segment.address + segment.bytes.length) {
      segment = { address: record.address, bytes: [] };
      segments.push(segment);
    }
    segment.bytes.push(...record.data);
  }
  return segments.map(segment => segment.bytes);
}

function extractPackedSource(segments) {
  for (const bytes of segments) {
    for (let offset = 0; offset <= bytes.length - 16; offset++) {
      if (!SOURCE_MAGIC.every((byte, index) => bytes[offset + index] === byte)) continue;

      const metadataLength = bytes[offset + 8] | (bytes[offset + 9] << 8);
      const sourceLength = (bytes[offset + 10] | (bytes[offset + 11] << 8) |
        (bytes[offset + 12] << 16) | (bytes[offset + 13] << 24)) >>> 0;
      const payloadStart = offset + 16;
      const payloadEnd = payloadStart + metadataLength + sourceLength;
      if (!metadataLength || !sourceLength || payloadEnd > bytes.length) {
        throw new Error("The MakeCode source block in this HEX file is incomplete.");
      }

      let metadata;
      try {
        const metadataBytes = Uint8Array.from(bytes.slice(payloadStart, payloadStart + metadataLength));
        metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes));
      } catch {
        throw new Error("The embedded MakeCode source header is invalid.");
      }
      if (metadata.eURL) {
        let editorUrl;
        try {
          editorUrl = new URL(metadata.eURL);
        } catch {
          throw new Error("This HEX file was not exported from a supported MakeCode Arcade editor.");
        }
        if (editorUrl.origin !== MAKECODE_ORIGIN) {
          throw new Error("This HEX file belongs to a different MakeCode editor, not MakeCode Arcade.");
        }
      }
      if (Number(metadata.textSize) > PROJECT_MAX_CHARACTERS) {
        throw new Error("The embedded MakeCode project is too large to load in the browser.");
      }
      return {
        metadata,
        compressed: Uint8Array.from(bytes.slice(payloadStart + metadataLength, payloadEnd))
      };
    }
  }
  throw new Error("No embedded MakeCode Arcade source was found in this HEX file.");
}

function validateProjectFiles(files) {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("The embedded MakeCode project does not contain a file map.");
  }
  const entries = Object.entries(files);
  if (entries.length > PROJECT_MAX_FILES) {
    throw new Error("The MakeCode project contains too many files to load safely.");
  }

  let totalCharacters = 0;
  for (const [name, content] of entries) {
    if (typeof content !== "string" || !name || name.startsWith("/") || name.includes("\\") ||
      name.split("/").some(part => part === ".." || part === ".")) {
      throw new Error("The embedded MakeCode project contains an invalid file.");
    }
    totalCharacters += content.length;
    if (totalCharacters > PROJECT_MAX_CHARACTERS) {
      throw new Error("The embedded MakeCode project is too large to load in the browser.");
    }
  }

  if (typeof files["pxt.json"] !== "string") {
    throw new Error("The HEX source does not include a MakeCode project configuration.");
  }
  try {
    JSON.parse(files["pxt.json"]);
  } catch {
    throw new Error("The embedded MakeCode project configuration is invalid.");
  }
  return files;
}

export async function extractMakeCodeProjectFromHex(text, decompress) {
  if (typeof decompress !== "function") {
    throw new Error("The MakeCode source decoder is unavailable.");
  }

  const { metadata, compressed } = extractPackedSource(sourceSegments(parseHexRecords(text)));
  if (metadata.compression !== "LZMA") {
    throw new Error("This HEX file uses an unsupported source compression format.");
  }

  const decoded = await decompress(compressed);
  const source = typeof decoded === "string"
    ? decoded
    : new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  if (!source || source.length > PROJECT_MAX_CHARACTERS) {
    throw new Error("The decompressed MakeCode project is empty or too large.");
  }

  const headerSize = Number(metadata.headerSize) || 0;
  if (!Number.isInteger(headerSize) || headerSize < 0 || headerSize >= source.length) {
    throw new Error("The embedded MakeCode project header is invalid.");
  }

  let extendedMetadata = {};
  let files;
  try {
    if (headerSize) extendedMetadata = JSON.parse(source.slice(0, headerSize));
    files = JSON.parse(source.slice(headerSize));
  } catch {
    throw new Error("The embedded MakeCode project source is invalid.");
  }
  if (extendedMetadata.files && typeof extendedMetadata.files === "object") {
    files = extendedMetadata.files;
  }
  return {
    files: validateProjectFiles(files),
    metadata: { ...metadata, ...extendedMetadata }
  };
}
