// A minimal, dependency-free EPUB reader used only to pull out enough plain text/metadata
// to hand to Gemini for title/author/description extraction (see geminiExtract.js).
//
// Gemini's document-understanding input doesn't accept the "application/epub+zip" mime
// type the way it natively accepts PDFs, so instead of shipping the raw file we unzip it
// ourselves (EPUB is just a ZIP archive) and pull:
//   1. The OPF package file (found via META-INF/container.xml) — this already contains
//      <dc:title>, <dc:creator>, <dc:description> if the book's metadata was filled in.
//   2. Plain text stripped from the first couple of spine chapters — a fallback/extra
//      context source for when the metadata above is missing or unhelpful (some EPUBs,
//      especially scanned/converted ones, leave the metadata blank or wrong).
//
// This is deliberately a small, forgiving parser (regex-based, not a full ZIP/XML
// implementation) — it only needs to work well enough on typical, non-corrupt EPUB files
// to give the AI something useful to read, not to be a general-purpose EPUB library.

const zlib = require("zlib");

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer) {
  // The EOCD record is at the very end of the file, but may be preceded by a variable-length
  // comment field, so scan backwards for its signature instead of assuming a fixed offset.
  const maxScan = Math.min(buffer.length, 65536 + 22);
  for (let i = buffer.length - 22; i >= buffer.length - maxScan; i--) {
    if (i < 0) break;
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

function listZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) throw new Error("Not a valid ZIP/EPUB file (no end-of-central-directory record found).");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(centralDirOffset) !== CENTRAL_DIR_SIGNATURE) break;
    const compressionMethod = buffer.readUInt16LE(centralDirOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralDirOffset + 20);
    const nameLength = buffer.readUInt16LE(centralDirOffset + 28);
    const extraLength = buffer.readUInt16LE(centralDirOffset + 30);
    const commentLength = buffer.readUInt16LE(centralDirOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralDirOffset + 42);
    const name = buffer
      .slice(centralDirOffset + 46, centralDirOffset + 46 + nameLength)
      .toString("utf8");

    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    centralDirOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer, entry) {
  const off = entry.localHeaderOffset;
  if (buffer.readUInt32LE(off) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Corrupt local file header for ${entry.name}`);
  }
  const nameLength = buffer.readUInt16LE(off + 26);
  const extraLength = buffer.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLength + extraLength;
  const compressed = buffer.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed; // stored, no compression
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed); // deflate
  throw new Error(`Unsupported ZIP compression method (${entry.compressionMethod}) for ${entry.name}`);
}

function stripHtml(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function firstTagText(xml, tagName) {
  // Matches both `<dc:title>...</dc:title>` and bare `<title>...</title>` forms.
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tagName}[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tagName}>`, "i");
  const m = xml.match(re);
  return m ? stripHtml(m[1]).trim() : "";
}

function joinPath(basePath, relativePath) {
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  const baseDir = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/") + 1) : "";
  const parts = (baseDir + relativePath).split("/");
  const stack = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

// Returns { title, author, description, sampleText } pulled from the EPUB's own metadata
// and (best-effort) the plain text of its first couple of chapters. Any field that
// couldn't be determined is returned as an empty string rather than throwing, since this
// is meant to feed an AI prompt, not to be authoritative on its own.
function readEpubMetadata(buffer, { maxSampleChars = 12000 } = {}) {
  const entries = listZipEntries(buffer);
  const entryByName = new Map(entries.map((e) => [e.name, e]));

  const containerEntry = entryByName.get("META-INF/container.xml");
  if (!containerEntry) throw new Error("Not a valid EPUB (missing META-INF/container.xml).");
  const containerXml = readZipEntry(buffer, containerEntry).toString("utf8");
  const opfPathMatch = containerXml.match(/full-path\s*=\s*"([^"]+)"/i);
  if (!opfPathMatch) throw new Error("Could not find the EPUB's package (.opf) file.");
  const opfPath = opfPathMatch[1];

  const opfEntry = entryByName.get(opfPath);
  if (!opfEntry) throw new Error(`EPUB package file referenced but not found in archive: ${opfPath}`);
  const opfXml = readZipEntry(buffer, opfEntry).toString("utf8");

  const title = firstTagText(opfXml, "title");
  const author = firstTagText(opfXml, "creator");
  const description = firstTagText(opfXml, "description");

  // Best-effort sample text: walk the manifest/spine to find the first one or two
  // actual (X)HTML content documents and strip their tags down to plain text.
  let sampleText = "";
  try {
    const manifestItems = [...opfXml.matchAll(/<item\b[^>]*>/gi)].map((m) => m[0]);
    const idToHref = {};
    const idToType = {};
    for (const tag of manifestItems) {
      const id = (tag.match(/\bid\s*=\s*"([^"]+)"/i) || [])[1];
      const href = (tag.match(/\bhref\s*=\s*"([^"]+)"/i) || [])[1];
      const mediaType = (tag.match(/\bmedia-type\s*=\s*"([^"]+)"/i) || [])[1] || "";
      if (id && href) {
        idToHref[id] = href;
        idToType[id] = mediaType;
      }
    }
    const spineRefs = [...opfXml.matchAll(/<itemref\b[^>]*idref\s*=\s*"([^"]+)"[^>]*>/gi)].map((m) => m[1]);

    let collected = "";
    for (const idref of spineRefs) {
      if (collected.length >= maxSampleChars) break;
      const href = idToHref[idref];
      const mediaType = idToType[idref] || "";
      if (!href || !/html|xml/i.test(mediaType)) continue;
      const fullPath = joinPath(opfPath, href.split("#")[0]);
      const contentEntry = entryByName.get(fullPath);
      if (!contentEntry) continue;
      const html = readZipEntry(buffer, contentEntry).toString("utf8");
      const text = stripHtml(html);
      if (text) collected += (collected ? "\n\n" : "") + text;
    }
    sampleText = collected.slice(0, maxSampleChars);
  } catch (e) {
    // Sample text is a bonus, not a requirement — metadata above still stands on its own.
    console.warn(`EPUB sample-text extraction failed (non-fatal): ${e.message}`);
  }

  return { title, author, description, sampleText };
}

module.exports = { readEpubMetadata };
