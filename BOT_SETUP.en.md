# Book Search Bot (interactive) — Setup

**The bot is for English books only.** The user sends: `Title - Author` (in English) → the bot searches the open libraries → shows the results with PDF / EPUB buttons → sends the file.

## New / modified files
| File | Role |
|---|---|
| `netlify/functions/telegram-webhook.js` (modified) | Forwards private-chat messages and button taps to the background worker. Its other duties (reactions/comments) are unchanged |
| `netlify/functions/bot-worker-background.js` (new) | Background Function: search + delivery (up to 15 minutes instead of 10 seconds) |
| `netlify/lib/bookBot.js` (new) | Parses the message, searches the sources in parallel, ranks results, de-duplicates, downloads/validates/uploads the file |
| `netlify/lib/botSession.js` (new) | Stores each chat's last results + rate limiting (Netlify Blobs) |

The sources used are the same ones already in `sources.js` (all legal): Project Gutenberg, Open Library/Internet Archive (unrestricted items), Google Books (public domain), Internet Archive texts, OAPEN, DOAB.

## Environment variables (Netlify)
- `BOT_TOKEN` — already exists.
- `TELEGRAM_WEBHOOK_SECRET` — **required now**: protects the webhook and the background worker.
- `SITE_URL` — optional (e.g. `https://yoursite.netlify.app`) if auto-detection doesn't work.

## Connecting the webhook (one-time)
```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<YOUR_SITE>.netlify.app/api/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","message_reaction_count","callback_query","pre_checkout_query"]'
```
Note: `callback_query` (the PDF/EPUB buttons) and `pre_checkout_query` (Stars payments — Telegram only gives the bot 10 seconds to approve, so it's answered directly inside `telegram-webhook.js`).

In BotFather: `/setcommands` then paste:
```
start - Start
help - How it works
balance - Free downloads and credits
buy - Buy download credits (Telegram Stars)
paysupport - Payment help
```

## Limits worth knowing
- Telegram lets bots upload files up to 50 MB; anything larger is sent as a link.
- 12 searches and 20 downloads per hour per chat (adjust this in `botSession.js`).
- Netlify's free tier has limits on invocations and execution time; watch usage if you get a lot of users.
- Recent copyrighted books usually won't appear — this is intentional.

## English-only restriction (how it works)
- A query with no Latin letters at all (Arabic/Russian/Chinese…) → a friendly reply asking for the title in English, with no search performed and no quota used.
- Filtering happens in two stages: (1) requesting the language from the source where it's supported (Gutendex `languages=en`, Open Library `language:eng`), then checking the language tag on every record across all sources (`en`/`eng`/`English`); (2) after the file is fetched, the language tag on archive.org is checked too.
- A record with no language tag at all is accepted only if its title and author are in Latin script.
- To extend this to other languages later, edit `ENGLISH_CODE`, `buildQueryFor`, and `gutendexEnglishUrl` in `netlify/lib/bookBot.js`.
- **Every bot message is in English only**, regardless of the user's Telegram language (the `t` object at the top of `netlify/functions/bot-worker-background.js`).

---

# The paid model: 3 free downloads a month, then Telegram Stars

## How it works
- **Searching is always free.** Only a file that **actually reaches** the user is counted; if delivery fails, the file is over 50MB, or it isn't a valid book, nothing is deducted.
- Each user gets `BOT_FREE_PER_MONTH` (default 3) free downloads per calendar month (UTC), renewing on the 1st. After that, **paid credits** are consumed (these never expire and carry over month to month).
- When credits run out, the pack offer is shown; the book the user requested is saved and, once payment succeeds, is **sent automatically**.
- Payment: `sendInvoice` in `XTR` currency (no provider token). On a successful payment the credit is added exactly once, even if Telegram resends the update (unique key = `telegram_payment_charge_id`).

## Suggested pricing (the defaults in the code)
| Pack | Stars | Per download | Buyer pays (approx.)* | You receive (approx.)* |
|---|---|---|---|---|
| 10 downloads | 40 ⭐ | 4.0 ⭐ | ~$0.80 | ~$0.52 |
| 30 downloads | 100 ⭐ | 3.3 ⭐ | ~$2.00 | ~$1.30 |
| 100 downloads | 300 ⭐ | 3.0 ⭐ | ~$6.00 | ~$3.90 |

\* Estimate: buying a Star in-app costs ≈ $0.02, and what you receive on withdrawal is ≈ $0.013 per Star (this changes). Minimum withdrawal is 1000 Stars (~$13), every new balance is held for 21 days, and payout is in TON via Fragment.

To change prices without touching the code: the `BOT_STAR_PACKS` environment variable, example:
`[{"id":"p10","downloads":10,"stars":40},{"id":"p30","downloads":30,"stars":100}]`
(`id` is letters/digits up to 16 chars, Stars between 1 and 10000).

## New environment variables
| Variable | Purpose |
|---|---|
| `BOT_FREE_PER_MONTH` | Number of free downloads per month (default 3) |
| `BOT_STAR_PACKS` | Star packs (JSON) |
| `BOT_FREE_HOSTS` | Download hosts that are never counted or charged. **Defaults to `gutenberg.org`** (see the legal notice). Leave it empty `""` to charge for everything |
| `BOT_DISABLED_SOURCES` | Source numbers (from `sources.js`) to disable, e.g. `4,6` to turn off OAPEN and DOAB |
| `ADMIN_CHAT_ID` | (already exists) enables admin commands and sends you a notification for every sale |
| `SUPPORT_CONTACT` | The support contact shown in `/paysupport` (e.g. `@your_username`) |
| `SEARCH_CACHE_TTL_HOURS` | How long cached search results stay valid (in hours), shared across all users for the same title/author. **Default 12**. `0` disables caching entirely. See "Search results cache" below |

## Commands
- User: `/balance` `/buy` `/paysupport`
- Admin only (`ADMIN_CHAT_ID`): `/refund <charge_id>` refunds the Stars via Telegram and withdraws the granted credit, `/grant <user_id> <n>` to grant credit (useful for testing without spending real Stars), and `/stats` / `/stats top` for owner statistics (see below).
- Telegram requires that a bot selling Stars support the `/paysupport` command.

## Legal notices (important before going live)
- **Project Gutenberg**: its license (clause 1.E.8) allows charging for access to or distribution of its files **only** if you pay 20% of gross profits to the foundation that owns the trademark, with refunds required in certain cases. That's why gutenberg.org files are **excluded from the quota by default**. If you want to charge for them, read the license and decide (`BOT_FREE_HOSTS=""`).
- **Other sources** (archive.org, Google Books, OAPEN, DOAB): their terms for commercial use haven't been verified. Some books on OAPEN/DOAB/IA carry non-commercial (NC) Creative Commons licenses, and charging for delivering them may violate that license. Review the terms, or exclude the source (`BOT_FREE_HOSTS` or `BOT_DISABLED_SOURCES`).
- A "paying for the service, not the books" framing doesn't remove these obligations. Consumer-protection and tax laws in your country may also apply to Stars sales — consult a professional.

---

# Search results cache

Search results (after validity checks and building the PDF/EPUB links) are cached temporarily in
Netlify Blobs (`bot-search-cache`) for `SEARCH_CACHE_TTL_HOURS` hours (default 12). Any user
searching the same title and author (regardless of case or spacing) within that time gets the
result instantly, without re-querying all six sources again — this cuts wait time and load on
free external sources (Gutenberg, Open Library, Google Books...), especially for
popular/repeated titles.

- **Cache key:** the title + author after normalization (case, punctuation, and diacritics
  ignored) plus the current `BOT_DISABLED_SOURCES` list — so a cached result built with a source
  you've since disabled is never served.
- **Only a fully successful search is cached** (every source responded and results were found). A
  search where a source failed, or where nothing was found, is not cached — so a partial outage
  doesn't get repeated, and a book has a chance to show up later.
- The cache has no bearing on quota/credits: those are only counted when a file is actually
  delivered, whether the search result came from the cache or a fresh search.
- Code: `netlify/lib/searchCache.js` (called from `searchBooks()` in `bookBot.js`).

---

# Owner statistics: `/stats`

Admin only (`ADMIN_CHAT_ID`). Anyone else who sends it just gets the normal help text, so its existence isn't revealed.

- **`/stats`** — summary for today, the last 7 days, the last 30 days and all time: users (total, new, active), searches (found / no results / sources down), files sent (PDF/EPUB; free / paid credit / exempt from quota), how many users hit the paywall, delivery failures, and Stars sales (with refunds and net).
- **`/stats top`** — most downloaded books, most frequent searches, **most frequent searches with no results** (shows what customers ask for that the sources can't provide), and files sent per source.

## Storage and accuracy
- Code: `netlify/lib/botStats.js`. Data lives in the Netlify Blobs store `bot-stats`: one small document per UTC day, one all-time document, one tiny document per user (first-seen date and last active day only), and aggregated top lists (**no user ids** in them).
- **Counting starts on the day this update is deployed** (the date is shown at the bottom of the report); earlier activity is not backfilled.
- Blobs has no transactions, so two events landing in the very same instant can lose one increment. Treat the numbers as trends, not accounting; the authoritative payment record remains the `charge:` entries in `bot-accounts` and Telegram's own Stars ledger.
- A statistics failure never breaks the bot: errors are swallowed and only written to the function log.
- You (the admin) are counted as a user too if you use the bot.

---

# Customer chat design

Everything a customer sees is in English and formatted with Telegram's HTML mode (bold headings, italic authors, tap-to-copy examples, quoted notices). All the text lives in the `t` object at the top of `netlify/functions/bot-worker-background.js`, so wording changes never touch the logic.

| Screen | What the customer sees |
|---|---|
| `/start` | Welcome card with a tap-to-copy example and a 2×2 menu: ❓ How it works · 🎟 My balance · ⭐ Get credits · 💬 Support |
| `/help` | 3-step guide (Search → Choose → Receive), commands, sources, and a quoted legal notice |
| Search | "🔎 Searching…" is **edited in place** into the results card (no message clutter) |
| Results | Numbered cards: **title**, *author*, 📚 source, 📄 PDF / 📘 EPUB badges, 🆓 for titles that don't use the allowance, plus the quota line. Buttons: `1️⃣ 📄 PDF` `1️⃣ 📘 EPUB` … and a footer row 🎟 Balance · ⭐ Get credits |
| Delivery | "⏳ Preparing your file…" becomes "✅ Delivered · 📄 PDF · 2.4 MB" + remaining allowance. The file itself carries a formatted caption (title, author, source, format, size) |
| Problems | Friendly cards ("File too large", "Couldn't send the file", "Results expired"…). Where a direct link exists there is a ⬇️ **Download directly** button; the allowance is never charged |
| `/balance` | Account card with a progress bar of the free allowance (▰▰▱) and a ⭐ Get credits button |
| `/buy` and paywall | One button per pack, with the saving shown against the priciest pack (e.g. `⭐ 300 · 100 downloads · save 25%`) |
| Payment | Receipt card with a tap-to-copy Receipt ID (`<code>`), which is what `/paysupport` asks for |

## Details worth knowing
- **Safety:** every value that comes from outside (book titles, authors, sources, receipt ids, `SUPPORT_CONTACT`) is escaped before it goes into HTML. If Telegram ever rejects a message's markup, the same words are re-sent as plain text, so a customer never sees an error because of formatting.
- **Admin messages** (`/stats`, `/refund`, `/grant`, sale notices) stay plain text on purpose, so values like `<charge_id>` are shown literally.
- **`BOT_BRAND`** (optional env var, default `Book Index`) — the name shown in the welcome card and on invoices.

## `/setup` (admin only) — no BotFather typing needed
Sends the bot's public profile through the Bot API in one go: the `/` command menu (start, help, balance, buy, paysupport), an **extra admin-only menu** visible only in your own chat (adds `/stats`, `/refund`, `/grant`, `/setup`), the description shown on an empty chat, and the short profile description. It replaces the manual `/setcommands` step above; run it once after deploying and again whenever you change `BOT_FREE_PER_MONTH` (the description mentions it).

---

# Channel integration (comments, post buttons, /book)

The same bot that answers customers also works inside your channel's **linked discussion group** (where the comments live) and under your posts. All three pieces are on by default and can be switched off independently.

## What it does
| Where | What happens |
|---|---|
| Under a comment | The bot replies to the commenter with a short invite and a **🔎 Search books in the bot** button (opens the bot). Wording rotates between a few variants, and a comment that sounds like a request ("do you have…", "pdf", "link"…) gets a more direct one. |
| `/book Title - Author` typed in the comments | The bot answers with a button that opens a private chat **and runs that search immediately** — the customer lands on the results, not on a blank chat. |
| Under every post the app publishes | The cover/caption message gets a **🔎 Search any book** button that opens the bot. (The file message is left untouched.) |
| `/stats` | The funnel is counted: invites sent, `/book` requests, and how many people opened the bot **from comments** vs **from post buttons**. |

## It replies only when it should
The bot never posts in a group just because it is there. An invite is sent only if **all** of this holds:
- the post belongs to **your** channel (published by this app, or listed in `TELEGRAM_CHANNELS` / `CHANNEL_ID`) — anyone can add a bot to any group, so other groups are ignored;
- the author is a real person: not a bot, not a group admin, not posting "as the channel", not you (`ADMIN_CHAT_ID`), and the comment has actual words (not just an emoji or sticker);
- it is a **top-level comment**, not a reply in a conversation between commenters;
- that person wasn't invited in the last **24 h**, the post hasn't already had **5** invites, and the group hasn't had **20** bot messages this hour;
- the previous attempt didn't fail (after a failure it pauses 30 min and tells you once, in your admin chat).

`/book` answers are explicit requests, so they skip those limits and only have a small per-person rate limit (10 per hour).

## One-time setup
1. **Bot ⇄ discussion group:** the bot must be a **member** of the group linked to the channel and allowed to send messages there.
2. **Privacy Mode off** (BotFather → your bot → Bot Settings → Group Privacy → Turn off) — the same requirement comment counting already had.
3. Webhook: unchanged (`allowed_updates` already includes `message`).
4. Optional: run `/setup` (admin) once so `/book` shows up in the group's `/` menu.
5. Redeploy. Check that it works by posting a test comment from a non-admin account.

Comments made before the webhook first saw a post's copy in the group (i.e. threads the bot never saw start) are not answered — same limitation as comment counting.

## Settings (all optional environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `COMMENT_REPLIES` | on | `off` = the bot never posts in the discussion group (invites **and** `/book`) |
| `COMMENT_REPLY_COOLDOWN_HOURS` | `24` | minimum hours before the same person is invited again |
| `COMMENT_REPLY_MAX_PER_THREAD` | `5` | invites per post; `0` = no cap |
| `COMMENT_REPLY_MAX_PER_HOUR` | `20` | bot messages per hour in the group (Telegram's own limit is about 20 per minute) |
| `POST_BOT_BUTTON` | on | `off` = no button under published posts |
| `BOT_USERNAME` | auto | the bot's @username; normally fetched with `getMe`, set it to save that call. An invalid value is ignored, and a missing username never blocks publishing — the button is simply skipped |

## Deep links used
`t.me/<bot>?start=cmt` (from a comment invite), `?start=post` (from a post button) and `?start=s_<base64url query>` (from `/book`, up to ~46 characters of query; longer titles fall back to the plain link). They are also how `/stats` knows where customers came from.

## Files
`netlify/lib/commentBot.js` (all the rules above), `netlify/lib/botLinks.js` (username + deep links), small hooks in `telegram-webhook.js`, `commentThreads.js`, `telegram.js` and `bot-worker-background.js`.
