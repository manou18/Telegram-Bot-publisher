const { requireAuth } = require("../lib/auth");
const { getChannels } = require("../lib/channels");

exports.handler = async (event) => {
  const authError = await requireAuth(event);
  if (authError) return authError;

  // chat_id is deliberately left out of the response — the frontend only ever needs to
  // refer to a channel by its short internal id, never the raw Telegram destination.
  const channels = getChannels().map((c) => ({
    id: c.id,
    name: c.name,
    categories: c.categories,
    default: c.default,
  }));
  return { statusCode: 200, body: JSON.stringify(channels) };
};
