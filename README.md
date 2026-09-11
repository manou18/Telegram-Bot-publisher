# Book Index — Netlify Version

The same browse-and-publish books interface, but built to run directly on Netlify:
the frontend is static pages (`public/`), and the logic (search + publishing to Telegram)
is Netlify Functions that run on demand and read the token from Netlify environment
variables — it never appears in browser code or gets pushed to the repo.

## Structure

```
telegram-book-bot/
├── netlify.toml            ← defines the publish folder and functions folder, and redirects /api/* to them
├── public/                  ← the static site
│   ├── index.html
│   ├── style.css
│   └── app.js
└── netlify/
    ├── functions/            ← each file here = an independent cloud function
    │   ├── sources.js
    │   ├── categories.js
    │   ├── browse.js
    │   ├── search.js
    │   ├── preview.js
    │   ├── publish.js
    │   ├── save.js            ← bookmark a book to publish later
    │   ├── unsave.js          ← remove a bookmark
    │   ├── saved.js           ← list bookmarked books
    │   ├── rate.js            ← (kept for API use; the UI no longer edits ratings manually)
    │   ├── stats.js           ← publishing statistics summary
    │   ├── export.js          ← download a JSON backup of published/saved/scheduled data
    │   ├── schedule.js        ← queue a book to auto-publish at a future date/time
    │   ├── scheduled.js       ← list scheduled books (pending + history)
    │   ├── scheduled-cancel.js← cancel a pending schedule / clear a resolved one
    │   ├── scheduled-publish.js ← cron job (not called by the frontend) that publishes due books
    │   ├── collection.js     ← browse any Archive.org collection by manually entering its identifier
    │   ├── publish-manual.js ← publish a manually-entered book (Add Manually tab)
    │   ├── copyright-check.js← best-effort public-domain advisory check for manual entries
    │   └── extract-book-info.js ← AI (Gemini) title/author/description extraction for manual entries
    └── lib/                   ← shared logic (book sources + sending to Telegram)
        ├── sources.js
        ├── telegram.js
        ├── bookIdentity.js    ← stable per-source dedupe key used by publishLog/savedBooks
        ├── copyrightCheck.js  ← logic behind the public-domain advisory check
        ├── geminiExtract.js   ← calls the Gemini API for the AI extraction feature
        ├── epubMeta.js        ← minimal EPUB (ZIP) metadata/text reader used by geminiExtract.js
        ├── publishLog.js      ← records previously published books (via Netlify Blobs)
        ├── savedBooks.js      ← records bookmarked ("save for later") books (via Netlify Blobs)
        └── scheduledBooks.js  ← records "publish later" schedules (via Netlify Blobs)
```

## Why this specific structure?

- **No persistent server:** Netlify doesn't run Express or any long-lived process, so
  `server.js` was replaced with six small separate functions (each request = an independent run).
- **No state kept in memory:** the cloud function may run on a different
  instance each time, so it can't "remember" the last search results the way the
  local server used to. That's why `/api/browse` and `/api/search` results now return
  the raw book data with each item, and the frontend sends it back as-is to
  `/api/preview` or `/api/publish` when needed — there's no reliance on server
  memory between requests.
- **Send the file as a URL first, then download/upload as a fallback plan:** the file URL
  is passed directly to Telegram first (lighter on the function), and Telegram itself
  fetches it — this works as long as the file is under 20 MB. If Telegram rejects the URL
  (usually due to size), the function automatically falls back to downloading the file and
  then uploading it as an actual file (multipart), which supports up to 50 MB but takes
  longer to execute — for books bigger than that you may need to upgrade your Netlify plan
  to increase the function timeout, or use Background Functions.

## Deploying to Netlify

### 1. Upload the project
Push this folder to a Git repository (GitHub/GitLab/Bitbucket), then from the
Netlify dashboard: **Add new site → Import an existing project** and pick the repo.
Netlify will detect `netlify.toml` automatically (publish folder `public`, functions folder
`netlify/functions`), so there's no need to configure any build settings manually.

### 2. Add the token as environment variables
From **Site settings → Environment variables → Add a variable** add:

| Key | Value |
|---|---|
| `BOT_TOKEN` | the bot token from BotFather |
| `CHANNEL_ID` | e.g. `@channel_username` |
| `SITE_PASSWORD` | a password you choose — required to use the site at all (see below) |
| `GEMINI_API_KEY` | optional — a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey), only needed for the "Add Manually" tab's ✨ Extract with AI button |

After saving, redeploy the site (Deploys → Trigger deploy) so the functions pick up the
new variables.

### 3. Try it out
Open the site URL Netlify gives you (like `your-site.netlify.app`) —
you'll find the same browse/search/preview/publish interface.

## Stats dashboard

The **📊 Stats** button (top right) opens a summary: total books published, how many are
currently saved for later, the average rating and a breakdown by star count, a count per
source, and the 8 most recently published books. It's read-only and computed on demand
from the same publish log and saved-books stores used elsewhere — no extra data is kept
just for this.

## Login rate limiting

After 3 incorrect password attempts from the same device/network, further attempts are
blocked for 1 hour — the error message shows the exact wait time and counts down. A
correct password immediately clears the count, so normal typos (1 or 2 wrong attempts)
never trigger anything. This is tracked in its own Netlify Blobs store, keyed by the
caller's IP address, so it doesn't affect other people using the tool from a different
network.

## Ranking previously-published books first

Browse, Search, and Collection results are sorted so that any book you already published
shows up first — highest rating at the top — with the star rating shown next to its title.
That rating comes from whatever was recorded when it was published (see "Rating a book
before publishing" below): a real reader rating pulled from the source when one exists,
otherwise no rating and no special ranking. Everything you haven't published yet keeps its
normal order underneath, since a book with no publish history has nothing to rank by.

## Filtering results by rating

A **Show:** dropdown above the results list lets you narrow the current Browse/Search/
Collection/Saved list to just **⭐ Rated only** or **Unrated only**, instead of scrolling
past everything to find the ones you already rated. Switching it doesn't re-fetch anything —
it just re-filters and re-sorts the results already on screen, so it stays instant even on
a slow connection.

## Searching within Saved Books

A text box appears above the results list only in the **📌 Saved Books** tab, filtering
the saved list by title or author as you type. Like the rating filter, this doesn't
re-fetch anything — it filters the saved books already loaded, and combines with the
rating filter and rating-based ranking at the same time.

## Password protection

The site is publicly reachable at whatever URL Netlify gives it, and it publishes
directly to your real Telegram channel — so every `/api/*` function requires the
`SITE_PASSWORD` you set above, sent as an `X-Site-Password` header. The frontend shows a
password screen before loading anything; once entered correctly it's remembered in the
browser (`localStorage`) so you're not asked again on that device. This is a simple
shared-secret check rather than real user accounts — good enough for a single admin/small
team, not meant to replace proper authentication for a multi-user setup.

## Extracting title/author/description with AI (Add Manually tab)

On the **➕ Add Manually** tab, once you've attached a cover image and/or a book file
(PDF/EPUB, uploaded or pasted as a URL), the **✨ Extract Title/Author/Description with AI**
button sends what you've attached to Google's Gemini API and fills in the Title, Author, and
Description fields for you:

- **PDF files** are sent to Gemini natively (it reads the document directly — cover page,
  title page, back-cover text, etc.).
- **EPUB files** aren't a format Gemini reads directly, so `netlify/lib/epubMeta.js` first
  unzips the EPUB locally (it's just a ZIP archive) and pulls out its own `<dc:title>` /
  `<dc:creator>` / `<dc:description>` metadata plus a plain-text sample of the opening
  chapters, and that's what gets sent to Gemini instead.
- The **cover image**, if attached, is sent as well (useful on its own if there's no book
  file yet, or as extra context alongside the file).

The description is asked for in the book's own language and capped to whatever will
actually fit in the Telegram post: 500 characters if a cover photo will be sent (Telegram's
photo-caption limit is 1024 characters total, and the rest of the caption needs room for the
title/author/source lines too) or 1500 characters if it's a text-only post — the same
`maxDescLen` logic `netlify/lib/telegram.js` uses when actually publishing. Whatever Gemini
returns is also hard-truncated server-side afterwards, so an overly long response still can't
break the actual publish step.

This is entirely optional and only pre-fills the form — nothing is auto-published, and you
should always read over the suggested title/author/description before hitting **Publish**.
Requires the `GEMINI_API_KEY` environment variable (see above); without it, every other part
of the app works as normal, just not this button. Very large PDFs (roughly over 15 MB) are
skipped automatically to stay under Gemini's request-size limit — you'll still get a result
from whichever of the cover/file it *could* read, with a note about what was skipped.

## Preventing duplicate publishing of the same book

Every book that's actually published gets recorded in a persistent store called
**Netlify Blobs** (key/value storage available to Netlify functions, which persists
between deployments unlike regular memory). The key used is a stable per-source identity
(Gutendex id, Open Library key, archive.org identifier, etc. — see
`netlify/lib/bookIdentity.js`), not the download URL, so publishing the same book again
later with a different format (PDF vs EPUB) is still caught as a duplicate. The saved-for-later
list (below) uses the same identity logic, so both features agree on what "the same book" means.

When you open the preview of a book that was already published, a warning message
appears in the preview window and the publish button switches to **"Publish Anyway"**
— so accidental duplicate publishing doesn't happen, but it remains possible on purpose
if you want (e.g. to update a post, or if you deleted it from the channel and manually
want to republish it).

This requires the `@netlify/blobs` package added in `package.json`, and it's enabled
automatically with no extra setup on your part — it works as soon as you deploy to Netlify.

## Rating a book before publishing

There's no manual star picker anymore. Two of the six sources — **Open Library** and
**Google Books** — expose a real reader rating for some of their books; when the book
being published has one, it's pulled in automatically and used as-is (e.g. ⭐⭐⭐⭐ (4.3/5))
in the message sent to the Telegram channel, and recorded alongside the entry in the
publish log. Project Gutenberg, the Internet Archive education collection, OAPEN, and
DOAB don't expose reader ratings at all, and neither does most of Open Library/Google
Books' own catalog — in those cases the book is just published with no rating, with
nothing to fill in and nothing blocking the Publish button.

Since Open Library and Google Books already include that rating in their list responses,
Browse/Search/Saved results are sorted with it too: books you've already published rank
first (highest published rating at the top), then — among everything else — books with a
real reader rating rank next, highest first, shown as a `📖4.3`-style badge next to the
title so it's visually distinct from a ⭐ published rating. Books with neither keep their
normal order at the bottom.

## Saving a book for later

While browsing, use **💾 Save for Later** in the preview window to bookmark a book without
publishing it right away — handy while you're scanning through results looking for the
worthwhile ones. Saved books show up under the **📌 Saved Books** tab; opening one from
there works exactly like opening it from Browse/Search (you can publish it, or just remove
the bookmark). A book is automatically removed from the saved list once it's actually
published. This also uses Netlify Blobs (its own store, separate from the duplicate-publish
log), so it needs no extra setup either.

## Most active by category (stats dashboard)

The stats dashboard now also breaks down published books **by category** (in addition to
by source) — e.g. how many "science fiction" vs "philosophy" books you've posted. This is
only tracked for books published while browsing a specific category (Browse Categories
tab); books published via Search, an Archive.org Collection, or the Saved Books list have
no category attached and aren't counted in this section.

## Bulk publishing from Saved Books

The **📌 Saved Books** tab now shows a checkbox next to each book plus a **Select all**
toggle and a **📮 Publish Selected** button. Checking a batch and clicking it publishes
them one after another — with a short pause between each post (about 1.8 seconds) so a
large batch doesn't trip Telegram's flood-control limits — and shows a running log of
what succeeded, what was already published, and what failed. There's no rating to be
missing anymore, so nothing in the selection gets skipped for that reason.

## File-size warning before publishing

The preview window already showed a book's file size; it now also flags when that size is
over **Telegram's 50 MB bot-upload limit** — right there in the preview, before you click
Publish, instead of finding out from a failed request afterward. This is just a heads-up
(publishing is still allowed) since large files sometimes work anyway if Telegram can
fetch the URL directly.

## Exporting a backup

Since Netlify Blobs has no browsable UI outside this app, the **⬇️ Export Backup** button
(top right, next to Stats) downloads a single JSON file containing everything currently
stored: the full publish log, the saved-for-later list, and all scheduled books (pending
and resolved). It's read-only and safe to run anytime — nothing is deleted or changed by
exporting. Handy as a manual backup, or for migrating the data if you ever move the site.

## Scheduling a book to publish later

The preview window now has a **🕒 Schedule** option below the usual Publish buttons: pick
a future date/time and click **Schedule** instead of publishing immediately. Just like
immediate publishing, the rating (if any) is pulled from the source automatically at
schedule time — there's nothing to fill in first. Scheduled books show up under the new
**🕒 Scheduled** tab, where you can see their status (🕒 Pending / ✅ Published /
⚠️ Failed) and cancel a pending one or clear a resolved one from the list.

Under the hood, a scheduled entry only stores the book's raw source item — not a snapshot
of its download link — so the actual file lookup happens fresh right before it's sent,
in case a link changes between when you schedule it and when it goes out.

A [scheduled Netlify Function](https://docs.netlify.com/functions/scheduled-functions/)
(`scheduled-publish.js`, configured in `netlify.toml` to run every 5 minutes) checks for
anything due and publishes it automatically — the same way immediate publishing does
(cover + caption, then the file, recorded in the publish log, removed from Saved Books if
it was there). Because it runs on a 5-minute cycle, a book scheduled for 3:02 PM will
typically go out within a few minutes of that time, not necessarily to the second. If
several books are due at once, they're sent one after another with the same ~2 second
spacing used for bulk publishing, to stay well under Telegram's rate limits.

⚠️ Scheduled Functions require a Netlify plan that supports them (they're available on
Netlify's free tier as of this writing, but double-check your plan if the schedule doesn't
seem to be firing) — if `scheduled-publish` never runs, scheduled books will just sit as
"Pending" until you either upgrade or publish them manually from Browse/Search instead.

## Running locally before deploying (optional)

```bash
npm install          # installs netlify-cli only
cp .env.example .env # and fill it in with the real token locally
npm run dev           # runs netlify dev on http://localhost:8888
```

`netlify dev` reads `.env` automatically and runs the same functions locally exactly as
they'll run on Netlify, so you can test actual publishing to your channel before deploying.

⚠️ I wasn't able to actually run this here since my environment has no outbound internet
access — I only verified the code's syntax is correct, so try it on your end and let me
know if you hit an error.


## Added legal sources

This version adds **Google Books — Public Domain** and **DOAB — Open Access Books**. Google Books direct download links are exposed only when Google marks the volume as full/public-domain access. DOAB is queried through its documented REST API.
