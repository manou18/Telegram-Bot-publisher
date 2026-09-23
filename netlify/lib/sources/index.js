// Registry of every book source, assembled from the per-source modules in this directory.
//
// To add a new source: create netlify/lib/sources/<name>.js exporting
// { name, categories, browseCategory, search, displayLine, buildBook, sourceRating? } — see
// gutenberg.js for the simplest example — then add one line below with the next free id.
// Nothing else in the app needs to change: every consumer imports SOURCES generically
// (SOURCES[id]) rather than importing any individual source module directly.
const gutenberg = require("./gutenberg");
const openlibrary = require("./openlibrary");
const archiveEdu = require("./archiveEdu");
const oapen = require("./oapen");
const googleBooks = require("./googleBooks");
const doab = require("./doab");
const libmanou = require("./libmanou"); // EXAMPLE — fictional source, see libmanou.js
const { fetchJson } = require("./_http");

const SOURCES = {
  1: gutenberg,
  2: openlibrary,
  3: archiveEdu,
  4: oapen,
  5: googleBooks,
  6: doab,
  7: libmanou, // EXAMPLE — remove this line (and libmanou.js) once you don't need it anymore
};

// Kept for backward compatibility — netlify/functions/collection.js and
// netlify/lib/copyrightCheck.js import these directly rather than through SOURCES.
module.exports = { SOURCES, archiveEduAdvancedSearch: archiveEdu.archiveEduAdvancedSearch, fetchJson };
