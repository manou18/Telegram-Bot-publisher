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
    │   └── collection.js     ← browse any Archive.org collection by manually entering its identifier
    └── lib/                   ← shared logic (book sources + sending to Telegram)
        ├── sources.js
        ├── telegram.js
        └── publishLog.js      ← records previously published books (via Netlify Blobs)
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

After saving, redeploy the site (Deploys → Trigger deploy) so the functions pick up the
new variables.

### 3. Try it out
Open the site URL Netlify gives you (like `your-site.netlify.app`) —
you'll find the same browse/search/preview/publish interface.

## Preventing duplicate publishing of the same book

Every book that's actually published gets recorded in a persistent store called
**Netlify Blobs** (key/value storage available to Netlify functions, which persists
between deployments unlike regular memory). The key used is the file's download URL
itself (or title+author+source if it was published with just its cover, no file).

When you open the preview of a book that was already published, a warning message
appears in the preview window and the publish button switches to **"Publish Anyway"**
— so accidental duplicate publishing doesn't happen, but it remains possible on purpose
if you want (e.g. to update a post, or if you deleted it from the channel and manually
want to republish it).

This requires the `@netlify/blobs` package added in `package.json`, and it's enabled
automatically with no extra setup on your part — it works as soon as you deploy to Netlify.

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
