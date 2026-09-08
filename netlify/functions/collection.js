const { SOURCES, archiveEduAdvancedSearch } = require("../lib/sources");

// Uses the same Archive.org search structure used in source 3 (education
// & teaching), but instead of a free-text search phrase, uses "collection:(id)" to
// show the content of a specific collection the user entered manually (like
// ukrainian-literature-school-curriculum or any other identifier from archive.org).
// Results are always built via source 3's logic (buildBook / displayLine) since they
// are all Internet Archive items regardless of the source selected in the UI.

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const collectionId = (q.collection || "").trim();
    if (!collectionId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Please enter a collection identifier" }) };
    }

    const query = `collection:(${collectionId})`;
    const data = await archiveEduAdvancedSearch(query, q.next || null);
    const archiveSource = SOURCES[3];
    const results = data.results.map((item) => ({ line: archiveSource.displayLine(item), item }));
    return { statusCode: 200, body: JSON.stringify({ results, next: data.next }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
