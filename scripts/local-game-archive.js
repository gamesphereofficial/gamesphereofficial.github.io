import { unzip, unzipSync } from "fflate";

export const MAX_LOCAL_ZIP_BYTES = 10 * 1024 * 1024;
export const MAX_LOCAL_EXPANDED_BYTES = 32 * 1024 * 1024;
export const MAX_LOCAL_FILES = 750;

export function safeGamePath(name) {
  const normalized = name.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes(":") ||
    normalized.includes("\0") ||
    normalized.split("/").some(part => part === "." || part === "..")
  ) {
    throw new Error("The ZIP contains an unsafe file path.");
  }
  return normalized;
}

export function findGameEntry(filePaths) {
  return filePaths
    .filter(path => /(^|\/)index\.html?$/i.test(path))
    .sort((left, right) => left.length - right.length)[0] || null;
}

function createArchiveFilter() {
  let fileCount = 0;
  let expandedBytes = 0;
  return file => {
    safeGamePath(file.name);
    if (!file.name.endsWith("/") && !file.name.endsWith("\\")) {
      fileCount += 1;
      const fileSize = Number(file.originalSize);
      if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
        throw new Error("The ZIP contains an invalid file entry.");
      }
      const unixFileType = (Number(file.attrs) >>> 16) & 0xf000;
      if (unixFileType === 0xa000) {
        throw new Error("The ZIP contains a symbolic link, which is not supported.");
      }
      expandedBytes += fileSize;
      if (fileCount > MAX_LOCAL_FILES) {
        throw new Error(`The ZIP contains more than ${MAX_LOCAL_FILES} files.`);
      }
      if (expandedBytes > MAX_LOCAL_EXPANDED_BYTES) {
        throw new Error("The extracted game exceeds the 32 MB local-play limit.");
      }
    }
    return true;
  };
}

function createLocalGame(archive) {
  const files = new Map(Object.entries(archive)
    .map(([name, bytes]) => [safeGamePath(name), bytes])
    .filter(([name]) => !name.endsWith("/")));
  const entryPath = findGameEntry([...files.keys()]);
  if (!entryPath) {
    throw new Error("No index.html was found in the uploaded ZIP.");
  }
  return { entryPath, files };
}

export function resolveGameAssetPath(reference, fromPath) {
  const value = reference.trim();
  if (!value || value.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) {
    return null;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]).replaceAll("\\", "/");
  } catch {
    return null;
  }
  if (!pathname) return null;

  const segments = pathname.startsWith("/")
    ? []
    : fromPath.split("/").slice(0, -1);
  for (const part of pathname.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    if (part.includes(":") || part.includes("\0")) return null;
    segments.push(part);
  }
  return segments.join("/");
}

export function unpackLocalGame(zipBytes) {
  if (!(zipBytes instanceof Uint8Array) || zipBytes.byteLength === 0 ||
      zipBytes.byteLength > MAX_LOCAL_ZIP_BYTES) {
    throw new Error("Choose a ZIP between 1 byte and 10 MB.");
  }

  const archive = unzipSync(zipBytes, {
    filter: createArchiveFilter()
  });

  return createLocalGame(archive);
}

export function unpackLocalGameAsync(zipBytes) {
  if (!(zipBytes instanceof Uint8Array) || zipBytes.byteLength === 0 ||
      zipBytes.byteLength > MAX_LOCAL_ZIP_BYTES) {
    return Promise.reject(new Error("Choose a ZIP between 1 byte and 10 MB."));
  }

  return new Promise((resolve, reject) => {
    unzip(zipBytes, { filter: createArchiveFilter() }, (error, archive) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(createLocalGame(archive));
      } catch (archiveError) {
        reject(archiveError);
      }
    });
  });
}
