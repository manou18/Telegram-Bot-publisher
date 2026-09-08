// Looks up a remote file's size without downloading it, so the UI can show the book's
// size before publishing. Most hosts answer a HEAD request with Content-Length; a few
// don't, so as a fallback we ask for just the first byte (Range: bytes=0-0) and read the
// total size back out of the Content-Range response header instead.
const TIMEOUT_MS = 6000;

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getRemoteFileSize(url) {
  if (!url) return null;

  try {
    const headRes = await fetchWithTimeout(url, { method: "HEAD" });
    const len = headRes.headers.get("content-length");
    if (len && Number(len) > 0) return Number(len);
  } catch (e) {
    // fall through to the Range fallback below
  }

  try {
    const rangeRes = await fetchWithTimeout(url, { headers: { Range: "bytes=0-0" } });
    const contentRange = rangeRes.headers.get("content-range"); // e.g. "bytes 0-0/123456"
    if (contentRange) {
      const total = Number(contentRange.split("/")[1]);
      if (total > 0) return total;
    }
    const len = rangeRes.headers.get("content-length");
    if (len && Number(len) > 0) return Number(len);
  } catch (e) {
    // give up quietly — file size is a nice-to-have, not worth failing the preview over
  }

  return null;
}

module.exports = { getRemoteFileSize };
