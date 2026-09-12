const { listQueue, getQueueSettings } = require("../lib/publishQueue");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const [records, settings] = await Promise.all([listQueue(event), getQueueSettings(event)]);

    // Best-effort "will go out around..." estimate per item, assuming the queue stays
    // enabled and nothing else changes — purely informational for the UI, never used to
    // decide anything on the backend (the cron always re-derives "is the next one due"
    // itself from settings.lastPublishedAt at the moment it runs).
    let nextAt = settings.lastPublishedAt
      ? new Date(settings.lastPublishedAt).getTime() + settings.intervalMinutes * 60000
      : Date.now();
    if (nextAt < Date.now()) nextAt = Date.now();
    const withEstimates = records.map((r, i) => ({
      ...r,
      estimatedFor: new Date(nextAt + i * settings.intervalMinutes * 60000).toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ records: withEstimates, settings }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
