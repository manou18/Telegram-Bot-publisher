// === 01: DOM element references + shared module-level state (mode flags, current selections, form values) ===
// Loaded first — everything else in public/js/ reads/writes these globals.

const sourceSelect = document.getElementById("sourceSelect");
const sourceField = document.getElementById("sourceField");
const channelField = document.getElementById("channelField");
const channelChecklist = document.getElementById("channelChecklist");
const categorySelect = document.getElementById("categorySelect");
const categoryField = document.getElementById("categoryField");
const searchField = document.getElementById("searchField");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const collectionField = document.getElementById("collectionField");
const collectionInput = document.getElementById("collectionInput");
const collectionBtn = document.getElementById("collectionBtn");
const resultsList = document.getElementById("resultsList");
const statusLine = document.getElementById("statusLine");
const ratingFilterSelect = document.getElementById("ratingFilterSelect");
const savedSearchInput = document.getElementById("savedSearchInput");
const nextPageBtn = document.getElementById("nextPageBtn");
const tabs = document.querySelectorAll(".tab");

const mainCatalog = document.getElementById("mainCatalog");
const loginOverlay = document.getElementById("loginOverlay");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

const statsBtn = document.getElementById("statsBtn");
const statsOverlay = document.getElementById("statsOverlay");
const closeStats = document.getElementById("closeStats");
const statsContent = document.getElementById("statsContent");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFileInput");

const healthBtn = document.getElementById("healthBtn");
const healthOverlay = document.getElementById("healthOverlay");
const closeHealth = document.getElementById("closeHealth");
const healthContent = document.getElementById("healthContent");

const bulkPublishBar = document.getElementById("bulkPublishBar");
const bulkSelectAll = document.getElementById("bulkSelectAll");
const bulkSelectedCount = document.getElementById("bulkSelectedCount");
const bulkPublishBtn = document.getElementById("bulkPublishBtn");
const bulkScheduleDateTime = document.getElementById("bulkScheduleDateTime");
const bulkScheduleBtn = document.getElementById("bulkScheduleBtn");
const bulkPublishStatus = document.getElementById("bulkPublishStatus");
const bulkPublishReviewOverlay = document.getElementById("bulkPublishReviewOverlay");
const closeBulkPublishReview = document.getElementById("closeBulkPublishReview");
const bulkReviewSummary = document.getElementById("bulkReviewSummary");
const bulkReviewList = document.getElementById("bulkReviewList");
const cancelBulkPublishReviewBtn = document.getElementById("cancelBulkPublishReviewBtn");
const confirmBulkPublishReviewBtn = document.getElementById("confirmBulkPublishReviewBtn");
const bulkQueueBtn = document.getElementById("bulkQueueBtn");
const bulkQueueForce = document.getElementById("bulkQueueForce");

const queueSettingsBar = document.getElementById("queueSettingsBar");
const queueEnabledToggle = document.getElementById("queueEnabledToggle");
const queueIntervalValue = document.getElementById("queueIntervalValue");
const queueIntervalUnit = document.getElementById("queueIntervalUnit");
const queueSaveSettingsBtn = document.getElementById("queueSaveSettingsBtn");
const queueSettingsStatus = document.getElementById("queueSettingsStatus");

const overlay = document.getElementById("previewOverlay");
const closePreview = document.getElementById("closePreview");
const previewCoverImg = document.getElementById("previewCoverImg");
const previewCoverFallback = document.getElementById("previewCoverFallback");
const previewSource = document.getElementById("previewSource");
const previewTitle = document.getElementById("previewTitle");
const previewAuthor = document.getElementById("previewAuthor");
const publishReviewOverlay = document.getElementById("publishReviewOverlay");
const closePublishReview = document.getElementById("closePublishReview");
const reviewCoverImg = document.getElementById("reviewCoverImg");
const reviewCoverFallback = document.getElementById("reviewCoverFallback");
const reviewSource = document.getElementById("reviewSource");
const reviewTitle = document.getElementById("reviewTitle");
const reviewAuthor = document.getElementById("reviewAuthor");
const reviewDescription = document.getElementById("reviewDescription");
const reviewMetaList = document.getElementById("reviewMetaList");
const reviewDuplicateWarning = document.getElementById("reviewDuplicateWarning");
const cancelPublishReviewBtn = document.getElementById("cancelPublishReviewBtn");
const confirmPublishReviewBtn = document.getElementById("confirmPublishReviewBtn");
const previewDescriptionInput = document.getElementById("previewDescriptionInput");
const rewriteDescriptionBtn = document.getElementById("rewriteDescriptionBtn");
const previewDescriptionNote = document.getElementById("previewDescriptionNote");
const previewDescriptionResult = document.getElementById("previewDescriptionResult");
const previewFileState = document.getElementById("previewFileState");
const previewSourceLink = document.getElementById("previewSourceLink");
const previewFileSize = document.getElementById("previewFileSize");
const previewFileSizeWarning = document.getElementById("previewFileSizeWarning");
const downloadLocalBtn = document.getElementById("downloadLocalBtn");
const downloadLocalHint = document.getElementById("downloadLocalHint");
const fileTypeChoice = document.getElementById("fileTypeChoice");
const fileTypePdf = document.getElementById("fileTypePdf");
const fileTypeEpub = document.getElementById("fileTypeEpub");
const coverChoiceRadios = document.getElementById("coverChoiceRadios");
const coverChoiceOriginal = document.getElementById("coverChoiceOriginal");
const coverChoiceCustom = document.getElementById("coverChoiceCustom");
const customCoverFile = document.getElementById("customCoverFile");
const customCoverPreview = document.getElementById("customCoverPreview");
const removeCustomCoverBtn = document.getElementById("removeCustomCoverBtn");
const customCoverUrlInput = document.getElementById("customCoverUrlInput");
const useCoverUrlBtn = document.getElementById("useCoverUrlBtn");

// Manual entry form
const resultsWrap = document.getElementById("resultsWrap");
const manualField = document.getElementById("manualField");
const mockupField = document.getElementById("mockupField");
const copyrightField = document.getElementById("copyrightField");
const watermarkField = document.getElementById("watermarkField");
const compressField = document.getElementById("compressField");
const cropField = document.getElementById("cropField");
const tgPreviewField = document.getElementById("tgPreviewField");
const copyrightTitleInput = document.getElementById("copyrightTitleInput");
const copyrightAuthorInput = document.getElementById("copyrightAuthorInput");
const copyrightCoverFile = document.getElementById("copyrightCoverFile");
const copyrightCoverPreview = document.getElementById("copyrightCoverPreview");
const copyrightRemoveCoverBtn = document.getElementById("copyrightRemoveCoverBtn");
const copyrightCoverUrlInput = document.getElementById("copyrightCoverUrlInput");
const copyrightUseCoverUrlBtn = document.getElementById("copyrightUseCoverUrlBtn");
const checkCopyrightByCoverBtn = document.getElementById("checkCopyrightByCoverBtn");
const manualTitleInput = document.getElementById("manualTitleInput");
const manualAuthorInput = document.getElementById("manualAuthorInput");
const manualDescriptionInput = document.getElementById("manualDescriptionInput");
const checkCopyrightBtn = document.getElementById("checkCopyrightBtn");
const copyrightResult = document.getElementById("copyrightResult");
const manualCoverFile = document.getElementById("manualCoverFile");
const manualCoverPreview = document.getElementById("manualCoverPreview");
const manualRemoveCoverBtn = document.getElementById("manualRemoveCoverBtn");
const manualCoverUrlInput = document.getElementById("manualCoverUrlInput");
const manualUseCoverUrlBtn = document.getElementById("manualUseCoverUrlBtn");
const manualBookFile = document.getElementById("manualBookFile");
const manualBookFileName = document.getElementById("manualBookFileName");
const manualRemoveFileBtn = document.getElementById("manualRemoveFileBtn");
const manualFileUrlInput = document.getElementById("manualFileUrlInput");
const manualUseFileUrlBtn = document.getElementById("manualUseFileUrlBtn");
const manualFileTypeChoice = document.getElementById("manualFileTypeChoice");
const manualSaveBtn = document.getElementById("manualSaveBtn");
const mockupCoverFile = document.getElementById("mockupCoverFile");
const mockupCoversList = document.getElementById("mockupCoversList");
const mockupCoverUrlInput = document.getElementById("mockupCoverUrlInput");
const mockupUseCoverUrlBtn = document.getElementById("mockupUseCoverUrlBtn");
const mockupGenerateBtn = document.getElementById("mockupGenerateBtn");
const mockupSceneSelect = document.getElementById("mockupSceneSelect");
const mockupResult = document.getElementById("mockupResult");
const mockupOutputWrap = document.getElementById("mockupOutputWrap");
const mockupResultImg = document.getElementById("mockupResultImg");
const mockupDownloadBtn = document.getElementById("mockupDownloadBtn");
const manualFileTypePdf = document.getElementById("manualFileTypePdf");
const manualFileTypeEpub = document.getElementById("manualFileTypeEpub");
const extractInfoBtn = document.getElementById("extractInfoBtn");
const extractInfoResult = document.getElementById("extractInfoResult");
const manualPublishBtn = document.getElementById("manualPublishBtn");
const manualPublishCoverOnlyBtn = document.getElementById("manualPublishCoverOnlyBtn");
const manualPublishResult = document.getElementById("manualPublishResult");
const previewDuplicateWarning = document.getElementById("previewDuplicateWarning");
const previewSavedNote = document.getElementById("previewSavedNote");
const previewScheduledNote = document.getElementById("previewScheduledNote");
const previewSourceRating = document.getElementById("previewSourceRating");
const saveBtn = document.getElementById("saveBtn");
const publishBtn = document.getElementById("publishBtn");
const publishCoverOnlyBtn = document.getElementById("publishCoverOnlyBtn");
const publishResult = document.getElementById("publishResult");
const scheduleDateTime = document.getElementById("scheduleDateTime");
const scheduleBtn = document.getElementById("scheduleBtn");

// Internet Archive source id in the backend registry (SOURCES) — collection browsing
// always uses it regardless of the visible "source" dropdown value, because any
// archive.org collection is built with the same source-3 data (buildBook/displayLine).
const ARCHIVE_SOURCE_ID = "3";

// Special value for the "All Sources" option — only meaningful in Search mode, since
// each real source's search already covers its whole catalog (no category filter),
// so searching "all sources" also inherently searches all of their categories.
const ALL_SOURCES_ID = "all";

let realSourceIds = []; // populated from /api/sources — the actual source ids (excludes "all")
let mode = "browse"; // "browse" | "search" | "collection"
let nextToken = null;
let allSourcesNextTokens = {}; // { [sourceId]: nextToken|null } — pagination state when "All Sources" is selected
let currentItem = null; // the raw currently selected item (sent as-is to preview/publish)
let currentItemSource = null; // the source id associated with currentItem when it was picked
let forceRepublish = false; // true if the user confirmed republishing an already-published book
let selectedFileType = null; // "pdf" | "epub" | null — the chosen format for publishing
let fileSizes = { pdf: null, epub: null }; // bytes, populated from the preview response
let downloadUrls = { pdf: null, epub: null }; // direct file links, for the "download locally" fallback
let coverChoice = "original"; // "original" | "custom" — which cover gets published
let customCoverValue = null; // data: URI (uploaded file) or http(s) URL (pasted link) for the custom cover
let manualCoverValue = null; // data: URI or URL for the manual-entry form's cover
let mockupCovers = []; // array of data: URIs / URLs for the standalone mockup tool's covers (1 = single book, 2-4 = collection)
const MOCKUP_MAX_COVERS = 4; // keep in sync with MAX_COLLECTION_COVERS in netlify/lib/coverMockup.js
let manualFileValue = null; // data: URI or URL for the manual-entry form's book file
let manualForceRepublish = false; // true if the user confirmed republishing an already-published manual entry
let manualIsSaved = false; // whether the current manual-entry form's book is in the "saved for later" list
let currentSourceRating = null; // the book's real reader rating from its source (Open Library /
                                 // Google Books), when one exists — read-only, never set by the user
let isSaved = false; // whether currentItem is currently in the "saved for later" list
let currentCategory = null; // the category label the user was browsing under when this book
                             // was picked (Browse mode only) — tagged onto publish/save/schedule
                             // purely so the stats dashboard can show "most active by category"
let currentHasCover = false; // whether the currently previewed book has a cover — decides which
                              // Telegram length limit (caption vs plain message) Rewrite-with-AI targets
let pendingPublishFn = null; // callback the review-overlay's "Confirm & Publish" runs once the
                              // user reviews and confirms — set by openPublishReviewForPreview()/
                              // openPublishReviewForManual()
let lastResults = []; // the most recently fetched (unfiltered) results — re-filtered/sorted
                       // in place when the rating filter changes, without a re-fetch
let ratingFilter = "all"; // "all" | "rated" | "top" | "unrated"
let currentSearchQuery = ""; // the text the user actually searched for (title/search tab only —
                              // empty for browse/collection/saved) — drives the relevance sort below

// A row's best-known rating: the rating you personally gave it if you published/rated it,
// otherwise the source's own reader rating (Open Library / Google Books) when available.
// Shared by sorting, the rating filter, and the row badge so all three agree on one number.
