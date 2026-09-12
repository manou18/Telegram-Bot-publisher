const { buildCoverMockup, SCENES, MAX_COLLECTION_COVERS } = require("../lib/coverMockup");
const { requireAuth } = require("../lib/auth");

// Standalone "generate a cover mockup" tool for the site owner — separate from the
// publish flow entirely. Takes one cover image (data: URL or plain image URL) or an
// array of 2+ covers for a side-by-side collection mockup, and returns the rendered
// mockup as a data: URL the frontend can preview and let the owner download. Never
// touches Telegram/the channel/publish log.
exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { cover_url: coverUrl, cover_urls: coverUrls, scene } = JSON.parse(event.body || "{}");
    const covers = Array.isArray(coverUrls) && coverUrls.length ? coverUrls : coverUrl ? [coverUrl] : [];
    if (!covers.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing cover_url or cover_urls." }) };
    }
    if (covers.length > MAX_COLLECTION_COVERS) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Too many covers for one mockup (max ${MAX_COLLECTION_COVERS}).` }),
      };
    }
    const sceneId = scene || "shelf";
    if (!SCENES.some((s) => s.id === sceneId)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Unknown scene "${sceneId}". Valid options: ${SCENES.map((s) => s.id).join(", ")}` }),
      };
    }

    const mockupBuffer = await buildCoverMockup(covers.length === 1 ? covers[0] : covers, sceneId);
    const mockupUrl = `data:image/png;base64,${mockupBuffer.toString("base64")}`;

    return { statusCode: 200, body: JSON.stringify({ mockup_url: mockupUrl }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
