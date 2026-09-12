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
│   └── js/                  ← the frontend logic, split into small ordered files (loaded
│       ├── 01-dom-state.js       in this order via <script> tags in index.html — plain
│       ├── 02-api-utils.js       global-scope scripts, not ES modules, so they share
│       ├── 03-browse-search.js   state exactly like the single app.js they replaced)
│       ├── 04-preview-publish.js
│       ├── 05-copyright-mockup.js
│       ├── 06-manual-save.js
│       ├── 07-stats-health-auth.js
│       └── 08-nav-ui.js     ← grouped-tab pills + the header "More" menu
└── netlify/
    ├── functions/            ← each file here = an independent cloud function
    │   ├── sources.js
    │   ├── categories.js
    │   ├── channels.js        ← lists configured Telegram publishing channels (for the "Publish to" checklist)
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
    │   │                          AND drains the publish queue (see "Publish Queue" below)
    │   ├── queue-add.js       ← add one or many books to the persistent publish queue
    │   ├── queue-list.js      ← list the queue + its drip-feed settings
    │   ├── queue-remove.js    ← remove one book from the queue
    │   ├── queue-reorder.js   ← move a queued book up/down
    │   ├── queue-settings.js  ← read/update the queue's enabled flag + interval
    │   ├── collection.js     ← browse any Archive.org collection by manually entering its identifier
    │   ├── publish-manual.js ← publish a manually-entered book (Add Manually tab)
    │   ├── copyright-check.js← best-effort public-domain advisory check for manual entries
    │   ├── extract-book-info.js ← AI (Gemini) title/author/description extraction for manual entries
    │   ├── feed.js            ← public RSS/Atom feed of everything published (see "RSS/Atom Feed" below)
    │   ├── refresh-views.js   ← cron job that refreshes Telegram view counts (see "View counts" below)
    │   ├── check-dead-links.js ← cron job that re-checks published download links (see "Dead link checking" below)
    │   ├── telegram-webhook.js ← receives reactions/comments pushed live by Telegram (see "Reactions & Comments" below)
    │   └── scheduled-backup.js ← cron job that pushes a daily backup to GitHub (see "Automated backups" below)
    └── lib/                   ← shared logic (book sources + sending to Telegram)
        ├── sources.js
        ├── telegram.js
        ├── telegraph.js       ← publishes long descriptions to Telegra.ph (see "Long Descriptions" below)
        ├── telegramViews.js   ← fetches a channel post's current view count (see "View counts" below)
        ├── postIndex.js       ← (chatId, messageId) → publish-log key, so webhook updates can find their book
        ├── commentThreads.js  ← maps a discussion-group comment thread back to its channel post
        ├── backupData.js      ← builds the backup payload shared by export.js and scheduled-backup.js
        ├── githubBackup.js    ← pushes the backup JSON to a GitHub repo via its Contents API
        ├── channels.js        ← parses TELEGRAM_CHANNELS (multi-channel publishing) with CHANNEL_ID fallback
        ├── adminAlert.js      ← sends a Telegram alert to ADMIN_CHAT_ID when a scheduled/queue publish fails unattended
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
| `CHANNEL_ID` | e.g. `@channel_username` — the single publishing destination, used when `TELEGRAM_CHANNELS` (below) isn't set |
| `TELEGRAM_CHANNELS` | optional — publish to **more than one** Telegram channel/group and let the publisher pick which one(s) each book goes to, instead of always using `CHANNEL_ID`. A JSON array, e.g.: `[{"id":"fiction","name":"📖 Fiction","chat_id":"@my_fiction_channel","categories":["fiction","romance"],"default":true},{"id":"nonfiction","name":"📚 Non-fiction","chat_id":"@my_nonfiction_channel","categories":["history","science"]}]`. Each entry: `id` (short internal id, any unique string), `name` (label shown in the app's "Publish to" checklist), `chat_id` (the real Telegram destination, same format `CHANNEL_ID` always used), `categories` (optional — source category ids this channel is the natural home for; used as a fallback when a publish request doesn't say which channel(s) to use), `default` (optional — `true` marks it as one of the channels used when nothing else decides it). When set, a "📡 Publish to" checklist appears above the tabs in the app; leave it unset (or with fewer than 2 entries) and the app behaves exactly as before, with `CHANNEL_ID` as the only destination. |
| `ADMIN_CHAT_ID` | optional — a Telegram chat id the bot sends an alert to (via the same bot/token) when an **unattended** publish fails: a one-off scheduled book that missed its only attempt, or a Publish Queue item that's exhausted its retries and gone "stuck". Interactive publishes (the Publish button, bulk publish) already show their errors right in the app, so those don't trigger this — it's specifically for failures that would otherwise sit silently in the function logs until someone happens to check. Can be your own personal chat with the bot, or a private admin group/channel it's a member of. To find your own chat id: message the bot anything, then open `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates` in a browser and look for `"chat":{"id": ...}` in the response. Leave unset to skip this entirely — nothing else about the app changes. Also doubles as the view-count "probe chat" (see "View counts" below) unless `VIEWS_PROBE_CHAT_ID` is set separately. |
| `VIEWS_PROBE_CHAT_ID` | optional — use a **different** chat than `ADMIN_CHAT_ID` for the view-count refresh mechanism (see "View counts" below). Only needed if you don't want the brief forward-then-delete flicker happening in your admin alerts chat. Leave unset to just reuse `ADMIN_CHAT_ID`. |
| `SITE_PASSWORD` | a password you choose — required to use the site at all (see below) |
| `GEMINI_API_KEY` | optional — a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey), only needed for the "Add Manually" tab's ✨ Extract with AI button and the 🪄 Rewrite Description with AI button |
| `GOOGLE_BOOKS_API_KEY` | optional — fixes the Google Books source's frequent `429` errors. Keyless requests to Google Books share ONE quota bucket used by every anonymous caller on the internet (not per-IP), which is usually already exhausted — get a free key at [Google Cloud Console](https://console.cloud.google.com/apis/library/books.googleapis.com) (enable the "Books API", then Credentials → Create API key) to use your own quota instead |
| `FEED_ENABLED` | optional — set to `false` to disable the public `/api/feed` RSS/Atom endpoint entirely (see "RSS/Atom Feed" below); left unset, the feed is on by default |
| `FEED_TITLE` / `FEED_DESCRIPTION` | optional — override the title/description shown in the `/api/feed` RSS/Atom output; default to a generic "Book Index — الكتب المنشورة" |
| `TELEGRAM_WEBHOOK_SECRET` | optional but strongly recommended once you set up the webhook for reactions/comments (see "Reactions & Comments" below) — a random string you choose, passed to `setWebhook` as `secret_token`; the webhook function rejects any request that doesn't echo it back in the `X-Telegram-Bot-Api-Secret-Token` header, since `/api/telegram-webhook` is public (Telegram can't send `X-Site-Password`) and this is what stops anyone else from posting fake updates to it. Leave unset only if you're not using the webhook at all — with it unset, the check is skipped entirely, which is fine for local testing but not recommended once deployed. |
| `GITHUB_BACKUP_TOKEN` / `GITHUB_BACKUP_REPO` | optional — enable the daily automated backup to GitHub (see "Automated backups" below). `GITHUB_BACKUP_REPO` is `owner/repo-name`; `GITHUB_BACKUP_TOKEN` is a GitHub personal access token with write access to that repo's contents. Leave either unset and the scheduled backup silently skips itself — the manual "Export Backup" button keeps working regardless. |
| `GITHUB_BACKUP_PATH` | optional — the file path within the repo the backup is written to. Defaults to `backups/book-index-backup.json`. |

After saving, redeploy the site (Deploys → Trigger deploy) so the functions pick up the
new variables.

### 3. Try it out
Open the site URL Netlify gives you (like `your-site.netlify.app`) —
you'll find the same browse/search/preview/publish interface.

## Stats dashboard

The **📊 Stats** button (in the **⋮ More** menu, top right) opens a summary: total books published, how many are
currently saved for later, the average rating and a breakdown by star count, a count per
source, and the 8 most recently published books. It's read-only and computed on demand
from the same publish log and saved-books stores used elsewhere — no extra data is kept
just for this.

## Publish Queue (group scheduling that feeds itself)

The **🔁 Publish Queue** tab is a persistent, self-sustaining alternative to the one-off
"Schedule Selected" bulk action. Instead of picking one fixed date/time for a whole batch,
you select books in **📌 Saved Books** and click **🔁 Add Selected to Queue** — they join an
ordered list that the existing 5-minute cron (`scheduled-publish.js`) drains one book at a
time, according to an interval you set (e.g. "every 6 hours" or "every 1 day") in the
Publish Queue tab itself. The queue never runs out on its own the way a one-off schedule
does: it simply idles once empty and picks back up the moment you add more books.

- **Enable/disable and interval** live in their own Netlify Blobs store
  (`publish-queue-settings`) — toggle "Auto-publish from queue" off to pause the drip
  without losing your place in the queue.
- Each queued book can be **reordered** (⬆️/⬇️) or **removed** from the Publish Queue tab.
- Exactly one book is published per due tick, and a failed attempt is retried on the next
  tick (it stays at the front of the queue) instead of being skipped or dropped.
- Adding to the queue runs the same duplicate check as **Publish** and **Schedule**: a book
  already published, already one-off scheduled, or already sitting in the queue is
  skipped by default (reported back so you can see which ones and why) — tick **"Include
  already published/scheduled/queued"** next to the button to force-add them anyway.
- **Export/Import** (the **⋮ More** menu) now includes the queue and its settings
  (enabled + interval) alongside published/saved/scheduled, so a backup restore doesn't
  lose books sitting in the drip-feed.
- This is separate from, and can be used alongside, the one-off **🕒 Scheduled** tab —
  use Scheduled for "this exact book at this exact time," and the Queue for "drip these
  books out automatically over the coming days/weeks."

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
(in the **⋮ More** menu, top right) downloads a single JSON file containing everything currently
stored: the full publish log, the saved-for-later list, and all scheduled books (pending
and resolved). It's read-only and safe to run anytime — nothing is deleted or changed by
exporting. Handy as a manual backup, or for migrating the data if you ever move the site.

## Long descriptions: Telegra.ph pages instead of truncation

Telegram enforces a hard cap on how much text a message can carry — 1024 characters for
a photo caption, 4096 for a plain text message (see `maxDescLen` in `telegram.js`). A
long book description (especially an AI-rewritten one) used to just get cut off mid-word
with an ellipsis once it passed that limit.

Now, whenever a description is too long to fit, `lib/telegraph.js` publishes the **full**
text to a [Telegra.ph](https://telegra.ph) page instead, and the Telegram post shows a
short teaser plus a "الوصف الكامل على Telegraph" link to the rest — so nothing actually
gets lost, no matter how long the description is. If creating the page fails for any
reason (Telegra.ph down, network error, etc.), it falls back to the old truncate-with-
ellipsis behavior so publishing itself never breaks.

No setup needed: Telegra.ph pages don't require a real account, so this works out of the
box with no extra environment variable. Short descriptions that already fit the limit are
published exactly as before — nothing changes for those.

## RSS/Atom Feed

`GET /api/feed` returns an RSS 2.0 feed of every book this app has published, newest
first — for anyone who'd rather follow new books in a feed reader than in the Telegram
channel itself. Add `?format=atom` for an Atom 1.0 feed instead, and `?limit=N` to change
how many items come back (default 50, max 200). Both formats are auto-discoverable from
the site's `<head>` (the RSS/Atom `<link rel="alternate">` tags any feed reader/browser
extension picks up automatically).

Each item includes the title, author, full description (no truncation — XML has no
1024/4096-char limit, so the Telegra.ph workaround above isn't needed here), the cover as
`<media:thumbnail>`, and the file as an `<enclosure>`/`<link>` when one was published.

This endpoint is intentionally **public** (not behind the site password) — a feed reader
can't send the `X-Site-Password` header, and everything in it is already sitting in the
public Telegram channel(s) this app publishes to. If that's not true for your setup
(e.g. you publish to a private channel and don't want the metadata exposed elsewhere
too), set `FEED_ENABLED=false` as an environment variable to turn the endpoint off
entirely (returns 404).

Only books published **after** this feature was added will have a description/cover/file
link in the feed — older publish-log entries predating it will still show up (title,
author, date) but with those extra fields empty, since they were never recorded before.

## View counts

Each book's stats now include how many times its Telegram post has been viewed, shown in
the **Stats dashboard** ("Total views", a "Most viewed" list, and next to each entry under
"Recently published") and folded into the `/api/feed` description.

**Why this needs a workaround at all:** the Bot API has no `getMessageViews`-style method
— a channel post's view count only ever shows up as a `views` field on a Message object,
and the only Message object the Bot API will hand back for a post that's already been
sent is the one you get by **forwarding** it somewhere. So that's what `lib/telegramViews.js`
does: forward the post to `ADMIN_CHAT_ID` (or `VIEWS_PROBE_CHAT_ID`, if you set that
instead), read `views` off the forwarded copy, then immediately delete that copy so
nothing is actually left behind — just a brief, silent flicker in that chat. This is a
known community workaround rather than an official, documented API guarantee, so treat
the numbers as "views as of the last refresh", not live/exact-to-the-second.

**Setup:** set `ADMIN_CHAT_ID` (you may already have it set for failure alerts — see
above) or `VIEWS_PROBE_CHAT_ID` to a chat the bot is a member of. Nothing else to
configure — leave both unset and the feature is simply off (stats show 0 views
everywhere, and the cron job below no-ops on every run rather than erroring).

**Refresh cadence:** `functions/refresh-views.js` runs on a schedule (every 10 minutes by
default, see `netlify.toml`) and refreshes a small batch of posts each time (15 by
default, oldest-refreshed-or-never-refreshed first), spaced ~1.2s apart to stay well
within Telegram's rate limits for the probe chat. A freshly-published book shows 0 views
until its first refresh cycle catches it; with more posts than `15 × (runs per day)` the
long tail just takes longer to cycle through — raise `BATCH_SIZE` in `refresh-views.js` or
shorten the cron interval in `netlify.toml` if you'd rather trade a bit more API usage for
fresher numbers. If a book was published to more than one channel (see
`TELEGRAM_CHANNELS`), its views are the **sum** across every channel it went to.

## Reactions & Comments

The Stats dashboard also shows total reactions ❤️ and comments 💬, a "Most engagement"
list, and per-book counts under "Recently published" — fed by a completely different
mechanism than views above, since Telegram actually **pushes** these to us live instead
of needing to be polled.

**How it works:** `functions/telegram-webhook.js` is a public endpoint Telegram calls
directly whenever something relevant happens, once you've told it to via `setWebhook`
(one-time setup below):

- **Reactions** come as a `message_reaction_count` update — Telegram hands over the
  channel, the post's `message_id`, and the full up-to-date reaction breakdown directly,
  no extra lookup needed.
- **Comments** are trickier, because Telegram has no "comment count" field for a post at
  all — a channel's comments are really just replies inside its **linked discussion
  group**. Every channel post gets an automatic copy in that group, and every comment on
  it is a reply threaded under that copy. `lib/commentThreads.js` remembers, the first
  time it sees that automatic copy, which channel post it belongs to; every later message
  in the same thread then counts as one more comment on that post.

**One-time setup:**

1. **Disable Privacy Mode** for your bot (message [@BotFather](https://t.me/BotFather) →
   `/mybots` → your bot → **Bot Settings** → **Group Privacy** → **Turn off**). Without
   this, the bot only sees messages that are commands or that mention it directly — it
   needs to see *every* message in the discussion group to count comments. (Skip this
   step if you only want reactions, not comments — reactions don't need it.)
2. Make sure the bot is a **member** of the channel's linked discussion group (Channel
   settings → Discussion → the group it's linked to). It doesn't need to be an admin
   there, just present.
3. Choose a random secret string and set it as `TELEGRAM_WEBHOOK_SECRET` in Netlify (see
   the environment variables table above for why).
4. Point Telegram at your deployed function (replace both placeholders):
   ```
   curl -F "url=https://<your-site>.netlify.app/api/telegram-webhook" \
        -F "secret_token=<same value as TELEGRAM_WEBHOOK_SECRET>" \
        -F "allowed_updates=[\"message\",\"message_reaction_count\"]" \
        https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
   ```
   A `{"ok":true,...}` response means it's live.

**This replaces `getUpdates` for this bot.** A bot can only use one or the other — once a
webhook is set, `getUpdates` (e.g. the trick used earlier to find your own chat id for
`ADMIN_CHAT_ID`) will always return an empty list. If you ever need `getUpdates` again,
run `https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook` first (comments/reactions
tracking stops until you `setWebhook` again).

**Limitations worth knowing:**

- Only books published **after** the post-index existed can have reactions/comments
  attributed to them at all — see `postIndex.js`. In practice this self-heals: every book
  published from here on is indexed automatically, and `refresh-views.js` also
  backfills the index for older posts as it cycles through them for views, so
  reactions/comments retroactively start working for a given old post once that cron job
  reaches it (see its comment).
- Comments only count from the moment the bot joined the discussion group with Privacy
  Mode off — older comments on old posts aren't retroactively counted, there's no API to
  fetch message history.
- Every single message sent in the discussion group triggers this webhook once — on a
  busy discussion group this could mean a meaningful number of function invocations, worth
  keeping in mind against Netlify's free-tier function-invocation limits.
- Like views, this relies on Telegram's actual behavior rather than a documented,
  guaranteed contract — if Telegram changes how it structures discussion-group threads,
  comment counting could silently stop working (reactions are on firmer ground, since
  `message_reaction_count` is an official, documented update type).

## Dead link checking

`functions/check-dead-links.js` runs every 6 hours (see `netlify.toml`) and re-checks a
batch of previously-published books' download links (25 per run, oldest-checked-or-never-
checked first — same batching approach as `refresh-views.js`, for the same reason: a
single run should only ever touch a small, rate-limit-friendly batch instead of hammering
every external host at once).

**How a link is checked:** a `HEAD` request (falling back to a 1-byte ranged `GET` for
hosts that don't support `HEAD`), with a 10-second timeout. Any response under 400 counts
as "alive" — this is checking "does the URL still resolve to something", not "is it still
exactly the right file".

**Avoiding false alarms:** a link only gets marked `dead` — and only then triggers an
alert — after **two consecutive** failed checks (roughly 6+ hours apart, given the
schedule above), not after a single one. A one-off timeout or a host having a bad moment
shouldn't page you; an actually-broken link showing the same failure twice in a row is a
much stronger signal.

**Where you see it:** the alert goes to `ADMIN_CHAT_ID` (same mechanism as
`notifyPublishFailure` — see its section above), and every book currently flagged `dead`
also shows up in a "⚠️ Dead links" section in the Stats dashboard, so you don't have to
rely on catching the alert message itself. Nothing is ever auto-deleted or auto-removed
from Telegram — this only tells you about a broken link, republishing or fixing the
source is a manual call.

## Automated backups (GitHub)

The manual **⬇️ Export Backup** button (see "Exporting a backup" above) still works
exactly as before — this adds a scheduled version of the same thing, so a recent backup
exists somewhere outside Netlify Blobs even if nobody remembers to click the button.
`functions/scheduled-backup.js` runs once a day and pushes the exact same data
(`lib/backupData.js` — the same function the manual button itself now uses, so both are
guaranteed to ship the same shape) to a file in a GitHub repo you choose.

**Why GitHub over S3:** GitHub's Contents API is plain authenticated HTTP — no request-
signing, no extra dependency, same `fetch()`-based approach as every Telegram call
already in this app. S3 would need AWS's request-signing scheme (SigV4), which in
practice means pulling in the full AWS SDK just for this one feature. GitHub is also free
for a private repo; S3 has a (small, but nonzero) per-GB storage cost.

**Why one file, not one-file-per-day:** the backup is written to the *same path* every
run (default `backups/book-index-backup.json`). GitHub already keeps every previous
version of a file in that file's own commit history — so you get a complete backup
history "for free", browsable/restorable from any of GitHub's history/diff tools,
without a repo that grows by one new file every single day forever.

**One-time setup:**

1. Create a **private** GitHub repo to hold backups (or reuse one you already have) —
   private is important, since the backup can include direct file download links.
2. Create a **personal access token** with write access to that repo only:
   [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)
   → **Generate new token** (fine-grained) → under **Repository access**, select **Only
   select repositories** and pick your backup repo → under **Permissions →
   Repository permissions**, set **Contents** to **Read and write** → Generate.
3. In Netlify, set:
   - `GITHUB_BACKUP_TOKEN` — the token from step 2
   - `GITHUB_BACKUP_REPO` — `your-username/your-backup-repo`
4. Redeploy. The first run happens at the next scheduled time (03:00 UTC by default —
   see `netlify.toml`); nothing needs to be triggered manually.

**If it fails** (an expired/revoked token, a renamed or deleted repo, a GitHub outage),
you get an alert on `ADMIN_CHAT_ID` — same mechanism as the other alerts in this app —
so a silently-broken backup doesn't go unnoticed for months. Leave
`GITHUB_BACKUP_TOKEN`/`GITHUB_BACKUP_REPO` unset and this whole feature is simply off; the
manual Export button is entirely unaffected either way.

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

## More accurate search ranking + fewer dead-end results

Two changes to how search results are ranked and shown, both purely client-side (no server/API changes):

1. **Relevance-first sorting.** Search results (the Search tab, any single source or "All Sources") now rank by how well each result actually matches what you typed — the exact book first, then the rest of that author's books, then everything else — instead of ranking purely by rating like before. This runs entirely in the browser against the results already returned by each source, so it can't fix a source returning zero relevant results, but it fixes the common case where the right book is buried on page 2 behind unrelated or lower-relevance hits. Browse-by-category and Saved Books are unaffected (there's no search text to rank against there).

2. **Fewer "no download link" dead ends.**
   - **Open Library / Internet Archive**: a search result can have several scanned copies (editions) listed under the hood. Previously only the first one was checked — if *that* particular copy was borrow-only/restricted, the whole result showed with no file, even when a second or third copy on the list was freely downloadable. It now tries each listed copy (up to 5) and uses the first one with an actual file.
   - **OAPEN / DOAB / Internet Archive — Education**: when a record genuinely has no direct file hosted there (metadata-only entries, or a publisher hosting the real file elsewhere), the preview now shows a **🔗 View on the source's page** link instead of just a dead "no file available" message — so you can at least follow it manually.

## About adding Standard Ebooks as a source

I looked into adding **Standard Ebooks** (standardebooks.org) as a seventh source, since it's a legitimate public-domain library with polished editions. It turned out not to be safely doable right now:

- Its OPDS/Atom catalog feed (the normal machine-readable way to query it) currently returns an authentication error for anonymous requests.
- The public website's "Keywords" search box doesn't appear to work through a plain URL parameter — testing a few likely parameter names against its browse pages just returned the unfiltered catalog instead of filtered results.

Rather than ship a "search" that silently returns wrong or empty results, I left this out. If you want it added as a **browse-only** source instead (e.g. by collection or by author, which do have stable URLs), or if you find their actual documented search parameter, let me know and I'll wire it in properly.

## Cover Mockup: scenes + book collections

The standalone "🖼️ Cover Mockup" tool (separate from publishing) now supports:
- **Scenes**: Bookshelf (original), Marble table, Reading corner — picked from a dropdown before generating.
- **Collections**: add 2–4 cover images instead of one, and they're rendered standing side by side on the same scene (with a shared shadow and slight natural height variance), instead of one book alone. A single cover still renders exactly as before.

Both are pure-`sharp`/SVG, same as the original mockup — no new dependency, no external service, no cost.

## Keeping Netlify Blobs usage inside the free tier

Netlify's free tier caps total Blobs storage, and two things in this app could otherwise grow that usage unnecessarily forever:

1. **A scheduled book's record used to keep its full payload after being resolved.** A manually-entered book's uploaded file/cover is stored as a base64 `data:` URI — up to tens of MB — directly inside its `scheduled-books` record. Once that book is actually published, Telegram already has the file and nothing in the app reads that payload again, so keeping it around was pure waste — the same is true when a scheduled book *fails*, since there's nothing left to retry automatically either way. `markScheduledResult()` now clears `item` (and a custom `cover_url`) the moment a scheduled book resolves as either `"published"` **or** `"failed"` — verified locally: a record holding a ~2MB fake upload shrank to well under 1KB immediately after being marked resolved. Immediate (non-scheduled) publishing was already fine here — it deletes the book from `saved-books` entirely after a successful publish.

2. **Nothing ever deleted old records.** Resolved `scheduled-books` entries were kept forever unless you manually hit "Clear". `http-cache` (search/browse response caching) was worse — every distinct search or category page you ever loaded left a permanent blob behind, even though the app already treats anything older than a few hours as useless.

   A new scheduled function, `netlify/functions/cleanup.js`, now runs **once a day** (`netlify.toml`, `0 3 * * *`) and prunes:
   - resolved (published/failed, never "pending") `scheduled-books` entries older than **1 month** (shortened from an original 1-year default now that both `published` and `failed` records are already stripped down to a few hundred bytes the moment they resolve — a whole year of that small history wasn't buying anything a month doesn't)
   - `http-cache` entries older than **1 day** (much shorter, since those are only ever useful for a few hours in the first place)

   `published-books` is deliberately **not** touched by this job: each record is only a few hundred bytes (title/author/source/rating/date — never a file), and its entire purpose is warning you if you try to republish a book you've already posted — a protection that's meant to last, not expire after a year. `cleanupOldPublished()` still exists in `publishLog.js` if you ever want a different policy there, it's just not wired into the cron job.

   `login-attempts` is also left alone — its records don't carry a timestamp unless they're actually locked out, and the store is small/self-limited enough that it wasn't worth touching that security-relevant code just for this.

Nothing here changes what you see in the app: the Scheduled tab only ever displayed title/author/source/rating/status/message for a resolved entry, never the stripped fields, and the duplicate-publish warning keeps working exactly as before, indefinitely.

## Caching the source/category lists in the browser (not counted against Netlify at all)

`/api/sources` and `/api/categories` return data that's hardcoded in `netlify/lib/sources.js` and never changes on its own, but the frontend used to call both again on every single page load (once at login to verify the password, then again right after to build the dropdowns) and again every time you switched sources. That's a Netlify function invocation for data that's identical every time.

The site owner's browser now caches both responses in its own `localStorage` for **1 year**, keyed by a SHA-256 hash of the exact request URL — same pattern as the server's own `netlify/lib/httpCache.js`, just client-side (see `cachedJsonFetch()` in `public/js/02-api-utils.js`). As long as a cached copy under a year old exists, the dropdowns are filled from it with **zero** network calls; only a first-ever visit, an expired entry, or a live-fetch failure (network hiccup, etc. — it then falls back to the stale copy rather than breaking the login screen) actually hits the function. This is pure browser storage, so it costs nothing against Netlify's Blobs or function-invocation limits, and it never touches the actual password check in `attemptLogin()`, which still calls `/api/sources` live every time on purpose (it's the only way to verify the password against the server).

If you ever change the sources/categories in `sources.js`, the site owner's browser will keep showing the old list for up to a year unless they clear their browser's site data (or their `localStorage`) manually — there's currently no in-app "refresh lists" button.

## Reorganized tabs, a compact header, and a split-up frontend

Three purely cosmetic/organizational changes, no behavior change to any feature:

- **Grouped tabs.** The 8 tabs (Browse / Search / Collection / Saved / Scheduled / Manual / Mockup / Copyright) used to sit in one row and wrapped onto multiple lines on narrow screens. They're now grouped under 3 pills — **📚 Browse Sources**, **📋 My Lists**, **🛠️ Tools** — and only the selected group's 2-3 tabs are shown at once. Each individual tab still works exactly as before (same `data-mode` attributes, same `setMode()` logic); the grouping is purely a `public/js/08-nav-ui.js` layer on top that shows/hides which row of tabs is visible.
- **Compact header.** The **📊 Stats**, **🩺 Sources**, **⬇️ Export Backup**, and **⬆️ Import Backup** buttons are now collapsed into a single **⋮ More** dropdown next to the title, instead of 4 separate buttons competing for header space.
- **Split frontend code.** The old single `public/app.js` (~2,300 lines) is now 8 smaller files under `public/js/`, loaded in order via `<script>` tags in `index.html` (see the file tree above for what each one covers). They're plain global-scope scripts, not ES modules, so they share state exactly like the one file they replaced — concatenating them back together in order reproduces the original file byte-for-byte. This is purely for readability/maintainability; nothing about how the app runs changed.

No changes were needed to `netlify.toml` or `package.json` for any of this — `netlify.toml`'s `publish = "public"` already serves the whole `public/` folder (including the new `public/js/` subfolder) as static files, and `package.json` has no build/bundling step over the frontend that referenced the old `app.js` filename.



