// A stable identifier for "this specific book result", independent of which format
// (PDF/EPUB) was later chosen for publishing and independent of incidental fields that
// can differ between two fetches of "the same" item (field order, transient snippet
// text, etc.). Used as the dedupe key for both the publish log and the saved-for-later
// list, so both features agree on what "the same book" means.
//
// Each source's raw item shape is different, so we pick the one field per source that
// actually identifies the underlying work/edition:
//   1 Project Gutenberg      -> Gutendex book id
//   2 Open Library           -> work/edition key, falling back to the Internet Archive id
//   3 Internet Archive (edu) -> archive.org identifier
//   4 OAPEN                  -> DSpace item uuid/handle
//   5 Google Books           -> volume id
//   6 DOAB                   -> DSpace item uuid/handle
//   manual (manual entry)    -> lowercased "title|author"
function getStableId(sourceId, item) {
  const id = String(sourceId);
  let value;

  switch (id) {
    case "1":
      value = item.id;
      break;
    case "2": {
      let iaId = null;
      if (Array.isArray(item.ia) && item.ia.length) iaId = item.ia[0];
      else if (typeof item.ia === "string") iaId = item.ia;
      value = item.key || iaId || (Array.isArray(item.edition_key) ? item.edition_key[0] : null);
      break;
    }
    case "3":
      value = item.identifier;
      break;
    case "4":
    case "6":
      value = item.uuid || item.handle || item.id;
      break;
    case "5":
      value = item.id;
      break;
    case "manual":
      value = `${String(item.title || "").trim().toLowerCase()}|${String(item.author || "").trim().toLowerCase()}`;
      break;
    default:
      value = null;
  }

  // Fall back to hashing the whole item if a source ever returns something without the
  // field we expect — better to occasionally miss a duplicate than to crash on it.
  if (!value) value = JSON.stringify(item);

  return `${id}:${value}`;
}

module.exports = { getStableId };
