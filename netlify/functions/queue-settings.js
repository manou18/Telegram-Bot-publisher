const { getQueueSettings, saveQueueSettings } = require("../lib/publishQueue");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod === "GET") {
      const settings = await getQueueSettings(event);
      return { statusCode: 200, body: JSON.stringify(settings) };
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { enabled, intervalMinutes } = JSON.parse(event.body || "{}");
    const patch = {};
    if (typeof enabled === "boolean") patch.enabled = enabled;
    // 5 minutes is the cron's own resolution (see netlify.toml) — anything tighter than
    // that wouldn't actually be honored, so it's floored here.
    if (typeof intervalMinutes === "number" && intervalMinutes >= 5) {
      patch.intervalMinutes = Math.round(intervalMinutes);
    }

    const settings = await saveQueueSettings(event, patch);
    return { statusCode: 200, body: JSON.stringify(settings) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
