const { requireAuth } = require("../lib/auth");
const { buildBackup } = require("../lib/backupData");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const backup = await buildBackup(event);

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="book-index-backup-${stamp}.json"`,
      },
      body: JSON.stringify(backup, null, 2),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
