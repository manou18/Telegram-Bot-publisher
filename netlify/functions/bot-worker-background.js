// The interactive book bot. Netlify runs "*-background" functions asynchronously (up to 15 min)
// and answers the caller with 202 right away — which is what we need here, because searching
// several libraries and then downloading + re-uploading a book (up to 50 MB) takes far longer
// than Telegram is willing to wait for a webhook reply.
//
// Called ONLY by telegram-webhook.js (which forwards private-chat messages and button taps).
// It is publicly reachable by URL like every Netlify function, so it refuses anything that
// doesn't carry the shared secret — otherwise anyone could make your bot message arbitrary chats.
//
// Monetisation: BOT_FREE_PER_MONTH free downloads per user per month, then credit packs sold for
// Telegram Stars (currency "XTR"). Searching is always free; only delivered files are counted.
//
// Look & feel: every customer-facing message is Telegram-HTML formatted (bold headings, italic
// authors, tap-to-copy examples). The searching/preparing "status" messages are edited in place
// into their final result, so the chat stays tidy. Anything that comes from outside (book titles,
// authors, sources, URLs, env values) goes through esc() before it is put into HTML.

const { parseQuery, searchBooks, tg, sendBookDocument, hasLatinLetters, esc, formatBytes } = require("../lib/bookBot");
const { saveResults, loadResults, searchLimit, downloadLimit, setPending, takePending } = require("../lib/botSession");
const { getFreePerMonth, getPacks, findPack, payloadFor, packFromPayload, isFreeUrl } = require("../lib/botPlans");
const { getAccount, reserveDownload, releaseDownload, creditPurchase, getCharge, markRefunded, grantCredits } = require("../lib/botAccount");
const { decodeSearchPayload } = require("../lib/botLinks");
const { track, touchUser, bumpTop, queryLabel, bookLabel, getReport, formatReport, formatTop } = require("../lib/botStats");

const brand = () => process.env.BOT_BRAND || "Book Index"; // shown in the welcome message / invoices
const NUM = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
const EXAMPLE = "Pride and Prejudice - Jane Austen";
const FORMAT_LABEL = { pdf: "📄 PDF", epub: "📘 EPUB" };

const short = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

// ▰▰▱ — a small progress bar for the free allowance (at most 10 cells).
function bar(left, total) {
  const len = Math.min(total, 10);
  const filled = Math.max(0, Math.min(len, Math.round((left / total) * len)));
  return "▰".repeat(filled) + "▱".repeat(len - filled);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The bot answers in English only, whatever the user's Telegram language is.
const t = {
  welcome: () => {
    const free = getFreePerMonth();
    return [
      `📚 <b>Welcome to ${esc(brand())}</b>`,
      "",
      "Send me an English book title and its author, and I'll find a free, legal <b>PDF</b> or <b>EPUB</b> for you.",
      "",
      "<b>Try it</b> — tap to copy:",
      `<code>${EXAMPLE}</code>`,
      "",
      free > 0
        ? `🎟 <b>${plural(free, "free download", "free downloads")}</b> every month · searching is always free`
        : "⭐ Downloads use credits (Telegram Stars) · searching is always free",
    ].join("\n");
  },

  help: () =>
    [
      "📖 <b>How it works</b>",
      "",
      "<b>1 · Search</b> — send the English title and author:",
      `<code>${EXAMPLE}</code>`,
      "",
      "<b>2 · Choose</b> — tap 📄 PDF or 📘 EPUB under the result you want.",
      "",
      "<b>3 · Receive</b> — the file arrives right here in the chat.",
      "",
      getFreePerMonth() > 0
        ? `🎟 <b>${plural(getFreePerMonth(), "free download", "free downloads")}</b> per month, then credits with Telegram Stars ⭐`
        : "⭐ Downloads use credits, paid with Telegram Stars",
      "🆓 Titles marked 🆓 never use your allowance.",
      "",
      "<b>Commands</b>",
      "/balance — free downloads &amp; credits",
      "/buy — get download credits",
      "/paysupport — payment help",
      "",
      "<i>Sources: Project Gutenberg, Open Library / Internet Archive, Google Books (public domain), OAPEN, DOAB.</i>",
      "",
      "<blockquote>⚖️ I only search legally available books (public domain / open access). Recent copyrighted books usually won't appear.</blockquote>",
    ].join("\n"),

  englishOnly: `🇬🇧 <b>English titles only</b>\n\nPlease send the English title and author, for example:\n<code>${EXAMPLE}</code>`,
  needText: `✏️ <b>Please send text</b>\n\nType the book title and author as a message, for example:\n<code>${EXAMPLE}</code>`,
  tooLong: "✂️ <b>That's a bit long</b>\n\nJust send the title and the author.",

  searching: (q) => `🔎 <b>Searching the libraries…</b>\n<i>“${esc(short(q, 80))}”</i>`,
  none:
    "😕 <b>No downloadable English edition found</b>\n\n" +
    "• Check the spelling of the title and author\n" +
    `• Use the format <code>Title - Author</code>\n` +
    "• Or try the title alone\n\n" +
    "<i>Recent books are usually still under copyright, so they won't appear here.</i>",
  allFailed: "⚠️ <b>The libraries are unreachable right now</b>\n\nPlease try again in a minute.",

  quota: (a) =>
    a.freeTotal > 0
      ? `🎟 <b>${a.freeLeft}</b>/${a.freeTotal} free left · ⭐ <b>${a.credits}</b> ${a.credits === 1 ? "credit" : "credits"}`
      : `⭐ <b>${a.credits}</b> ${a.credits === 1 ? "credit" : "credits"}`,

  balance: (a) =>
    [
      "📊 <b>Your account</b>",
      "",
      a.freeTotal > 0 ? `🎟 Free downloads  ${bar(a.freeLeft, a.freeTotal)}  <b>${a.freeLeft}/${a.freeTotal}</b>` : null,
      `⭐ Paid credits  <b>${a.credits}</b>`,
      "",
      a.freeTotal > 0
        ? "<i>Free downloads reset on the 1st of each month (UTC). Paid credits never expire.</i>"
        : "<i>Paid credits never expire.</i>",
    ]
      .filter((x) => x != null)
      .join("\n"),

  buyIntro: (a) => `${t.balance(a)}\n\n⭐ <b>Choose a credit pack</b> — paid with Telegram Stars. One credit = one download.`,

  paywall: () => {
    const free = getFreePerMonth();
    return [
      free > 0 ? "🔒 <b>Free downloads used up</b>" : "🔒 <b>Credits needed</b>",
      "",
      free > 0
        ? `You've used all <b>${free}</b> free downloads this month — they reset on the 1st (UTC).`
        : "Downloads use credits, paid with Telegram Stars.",
      "",
      "⭐ Pick a pack below. Your selected book is sent automatically right after payment.",
    ].join("\n");
  },

  paid: (n, charge, a) =>
    [
      "✅ <b>Payment received</b>",
      "",
      `➕ <b>${plural(n, "download credit", "download credits")}</b> added`,
      `⭐ Balance: <b>${a.credits}</b> ${a.credits === 1 ? "credit" : "credits"}`,
      "",
      `🧾 Receipt: <code>${esc(charge)}</code>`,
    ].join("\n"),

  payProblem: (charge) =>
    [
      "⚠️ <b>Your payment needs attention</b>",
      "",
      "It arrived, but I couldn't match it to an offer. Please use /paysupport and quote this receipt:",
      `<code>${esc(charge)}</code>`,
    ].join("\n"),

  paySupport: () =>
    [
      "💳 <b>Payment help</b>",
      "",
      `Something went wrong with a payment? Contact <b>${esc(process.env.SUPPORT_CONTACT || "the bot owner")}</b> and include the Receipt ID shown after your purchase.`,
      "",
      "<i>Credits never expire · searching is always free.</i>",
    ].join("\n"),

  refunded: (stars) =>
    `↩️ <b>Payment refunded</b>\n\n<b>${stars}⭐</b> was returned to you through Telegram. The matching download credits were removed from your balance.`,

  wait: (s) => `⏳ <b>Easy there!</b> Please try again in <b>${s}s</b>.`,
  expired: "⌛ <b>These results have expired</b>\n\nSend the book title again to start a new search.",
  error: "😬 <b>Something went wrong</b>\n\nPlease try again.",

  preparing: (book, format) => `⏳ <b>Preparing your file…</b>\n<i>${esc(short(book.title, 90))}</i> · ${FORMAT_LABEL[format]}`,
  sent: (format, bytes, a) =>
    `✅ <b>Delivered</b> · ${FORMAT_LABEL[format]}${bytes ? ` · ${formatBytes(bytes)}` : ""}\n\n${t.quota(a)}`,
  sentFree: (format, bytes) =>
    `✅ <b>Delivered</b> · ${FORMAT_LABEL[format]}${bytes ? ` · ${formatBytes(bytes)}` : ""}\n\n🆓 <i>Free title — your allowance wasn't used.</i>`,
  tooLarge: "📦 <b>File too large to send</b>\n\nThis file is over 50 MB, Telegram's limit for bots. Your allowance was <b>not</b> used — you can download it directly:",
  notBook: "⚠️ <b>That link didn't return a valid book</b>\n\nThe source sent something that isn't a PDF or EPUB. Your allowance was <b>not</b> used.",
  failed: "⚠️ <b>I couldn't send the file</b>\n\nThe transfer was interrupted. Your allowance was <b>not</b> used — you can download it directly:",

  profileDescription: () =>
    "Find free, legal English books as PDF or EPUB from open libraries like Project Gutenberg, Open Library and the Internet Archive.\n\n" +
    `Send a title and author, e.g. “${EXAMPLE}”, and get the file right here.\n\n` +
    (getFreePerMonth() > 0 ? `Searching is always free · ${getFreePerMonth()} free downloads every month.` : "Searching is always free."),
  profileShort: () => "Free, legal English books as PDF or EPUB. Send a title and author.",
};

// ---------------------------------------------------------------- sending helpers

const isAdmin = (chatId) => !!process.env.ADMIN_CHAT_ID && String(chatId) === String(process.env.ADMIN_CHAT_ID);

// Plain text (admin / technical messages, where values like "<charge_id>" must stay literal).
const say = (chatId, text, extra = {}) => tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...extra });

const stripHtml = (s) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// Customer-facing message (Telegram HTML). If Telegram ever rejects the markup we still deliver
// the words, as plain text, instead of leaving the customer with an error.
async function send(chatId, text, extra = {}) {
  try {
    return await say(chatId, text, { parse_mode: "HTML", ...extra });
  } catch (e) {
    if (!/parse entities/i.test(e.message)) throw e;
    console.error("HTML message rejected, resending as plain text:", e.message);
    return say(chatId, stripHtml(text), extra);
  }
}

// Turns a status message ("Searching…") into its final content; falls back to a new message.
async function edit(chatId, messageId, text, extra = {}) {
  if (messageId) {
    try {
      return await tg("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
    } catch (e) {
      console.error("Edit failed, sending a new message instead:", e.message);
    }
  }
  return send(chatId, text, extra);
}

const notifyAdmin = (text) =>
  process.env.ADMIN_CHAT_ID ? say(process.env.ADMIN_CHAT_ID, text).catch((e) => console.error("Admin notice failed:", e.message)) : null;

// ---------------------------------------------------------------- keyboards

const buyButton = { text: "⭐ Get credits", callback_data: "m:buy" };

const mainMenu = () => ({
  inline_keyboard: [
    [{ text: "❓ How it works", callback_data: "m:help" }, { text: "🎟 My balance", callback_data: "m:bal" }],
    [buyButton, { text: "💬 Support", callback_data: "m:support" }],
  ],
});

// "⭐ 100 · 30 downloads · save 17%" — the saving is measured against the priciest pack per download.
const packKeyboard = () => {
  const packs = getPacks();
  const rate = (p) => p.stars / p.downloads;
  const worst = Math.max(...packs.map(rate));
  return {
    inline_keyboard: packs.map((p) => {
      const save = Math.round((1 - rate(p) / worst) * 100);
      return [{ text: `⭐ ${p.stars} · ${p.downloads} downloads${save >= 5 ? ` · save ${save}%` : ""}`, callback_data: `buy:${p.id}` }];
    }),
  };
};

function resultsKeyboard(results) {
  const rows = results.map((b, i) => {
    const n = NUM[i] || String(i + 1);
    const row = [];
    if (b.pdf) row.push({ text: `${n} 📄 PDF`, callback_data: `d:${i}:p` });
    if (b.epub) row.push({ text: `${n} 📘 EPUB`, callback_data: `d:${i}:e` });
    return row;
  });
  rows.push([{ text: "🎟 Balance", callback_data: "m:bal" }, buyButton]);
  return { inline_keyboard: rows };
}

// A "download directly" button — only for links Telegram will accept as URL buttons.
const linkKeyboard = (url, label) => (/^https?:\/\//i.test(url) ? { inline_keyboard: [[{ text: label, url }]] } : undefined);

function resultsCard(q, results, account, approximate) {
  const anyFree = results.some((b) => [b.pdf, b.epub].filter(Boolean).every(isFreeUrl));
  const cards = results.map((b, i) => {
    const formats = [b.pdf && FORMAT_LABEL.pdf, b.epub && FORMAT_LABEL.epub].filter(Boolean).join(" · ");
    const free = [b.pdf, b.epub].filter(Boolean).every(isFreeUrl);
    return [
      `${NUM[i] || `${i + 1}.`} <b>${esc(short(b.title, 90))}</b>`,
      b.author ? `<i>${esc(short(b.author, 60))}</i>` : null,
      `📚 ${esc(short(b.source, 60))} · ${formats}${free ? " · 🆓" : ""}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `📖 <b>Results for</b> <i>“${esc(short(q, 80))}”</i>`,
    approximate ? "🔍 <i>No exact match — here are the closest titles we found:</i>" : null,
    "",
    cards.join("\n\n"),
    "",
    t.quota(account),
    anyFree ? "🆓 = free title, doesn't use your allowance" : null,
    "",
    "👇 <b>Choose a format</b>",
  ]
    .filter((x) => x != null)
    .join("\n");
}

// ---------------------------------------------------------------- entry point

// The actual work: routes an update to the callback/message handler and makes sure a failure
// still gets *something* back to the user instead of silent nothing. Exported so telegram-webhook.js
// can call it directly, in-process, instead of firing an HTTP request at this file's own endpoint
// (that indirection only works when "-background" functions are enabled, which requires a Netlify
// Pro plan or above; on the Free plan a self-fetch to a "-background" function never runs).
async function processBotUpdate(event, update) {
  const chatId = (update.callback_query && update.callback_query.message && update.callback_query.message.chat.id) ||
    (update.message && update.message.chat && update.message.chat.id);

  try {
    if (update.callback_query) await onCallback(event, update.callback_query);
    else if (update.message) await onMessage(event, update.message);
  } catch (e) {
    console.error("Bot worker failed:", e);
    if (chatId) await send(chatId, t.error).catch(() => {});
  }
}

// Kept so this file still works as a standalone endpoint (e.g. if you upgrade to Pro and want to
// go back to true background execution). Not used by telegram-webhook.js anymore.
exports.handler = async (event) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || (event.headers || {})["x-bot-worker-secret"] !== secret) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  let update;
  try {
    update = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "" };
  }

  await processBotUpdate(event, update);
  return { statusCode: 200, body: "" };
};

exports.processBotUpdate = processBotUpdate;

// ---------------------------------------------------------------- messages & commands

async function onMessage(event, message) {
  if (!message.chat || message.chat.type !== "private" || (message.from && message.from.is_bot)) return;
  const chatId = message.chat.id;
  await touchUser(event, chatId);
  if (message.successful_payment) return onPayment(event, message);

  let text = (message.text || "").trim();

  // Deep links from the channel: /start cmt (bot reply under a comment), /start post (button under a
  // post) and /start s_<query> (a /book request typed in the comments — search it right away).
  const deep = /^\/start(?:@\w+)?\s+(\S+)$/i.exec(text);
  if (deep) {
    const source = deep[1];
    const query = decodeSearchPayload(source);
    if (query) {
      await track(event, { startCmt: 1 });
      text = query; // continues below as if the customer had typed it
    } else if (/^cmt/i.test(source)) {
      await track(event, { startCmt: 1 });
    } else if (/^post/i.test(source)) {
      await track(event, { startPost: 1 });
    }
  }
  if (!text) return void (await send(chatId, t.needText));

  const cmd = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
  if (cmd) {
    const name = cmd[1].toLowerCase();
    const arg = (cmd[2] || "").trim();
    switch (name) {
      case "start":
        return void (await send(chatId, t.welcome(), { reply_markup: mainMenu() }));
      case "balance":
      case "account":
        return void (await send(chatId, t.balance(await getAccount(event, chatId)), { reply_markup: { inline_keyboard: [[buyButton]] } }));
      case "buy":
      case "plans":
        return void (await send(chatId, t.buyIntro(await getAccount(event, chatId)), { reply_markup: packKeyboard() }));
      case "paysupport":
        return void (await send(chatId, t.paySupport()));
      case "refund":
        return void (await onRefund(event, chatId, arg));
      case "grant":
        return void (await onGrant(event, chatId, arg));
      case "stats":
        return void (await onStats(event, chatId, arg));
      case "setup":
        return void (await onSetup(chatId));
      case "book":
      case "search":
      case "find":
        break; // handled as a search below
      default:
        return void (await send(chatId, t.help())); // /help, anything unknown
    }
  }
  if (text.length > 200) return void (await send(chatId, t.tooLong));

  const q = parseQuery(text);
  // English-only bot: a query with letters but none of them Latin (Arabic, Cyrillic, CJK…) can't
  // match. Checked first, because a lone Arabic word like "كتاب" is a stop-word and would
  // otherwise be mistaken for an empty query.
  if (/\p{L}/u.test(q.raw) && !hasLatinLetters(q.raw)) return void (await send(chatId, t.englishOnly));
  if (!q.titleTokens.length && !q.authorTokens.length) return void (await send(chatId, t.needText));

  const limit = await searchLimit(event, chatId);
  if (!limit.ok) return void (await send(chatId, t.wait(limit.retryAfterSec)));

  const status = await send(chatId, t.searching(q.raw)).catch(() => null);
  const statusId = status && status.message_id;
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});

  const { results, failedSources, approximate } = await searchBooks(event, q);
  if (!results.length) {
    // every source failing is a different problem from "nothing matched"
    const down = failedSources.length >= 5;
    await Promise.all([
      track(event, { search: 1, [down ? "searchDown" : "searchMiss"]: 1 }),
      down ? null : bumpTop(event, "misses", queryLabel(q.raw)),
    ]);
    return void (await edit(chatId, statusId, down ? t.allFailed : t.none));
  }
  await Promise.all([
    track(event, { search: 1, searchHit: 1, ...(approximate ? { searchApprox: 1 } : {}) }),
    bumpTop(event, "queries", queryLabel(q.raw)),
  ]);

  await saveResults(event, chatId, q.raw, results);
  const account = await getAccount(event, chatId);
  await edit(chatId, statusId, resultsCard(q.raw, results, account, approximate), { reply_markup: resultsKeyboard(results) });
}

// ---------------------------------------------------------------- button taps

async function onCallback(event, cb) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const answer = (extra = {}) => tg("answerCallbackQuery", { callback_query_id: cb.id, ...extra }).catch(() => {});
  if (!chatId) return void (await answer());
  await touchUser(event, chatId);

  // menu shortcuts (welcome message + results footer)
  const menu = /^m:(help|bal|buy|support)$/.exec(cb.data || "");
  if (menu) {
    await answer();
    if (menu[1] === "help") {
      await send(chatId, t.help());
      return;
    }
    if (menu[1] === "support") return void (await send(chatId, t.paySupport()));
    const account = await getAccount(event, chatId);
    if (menu[1] === "bal") {
      await send(chatId, t.balance(account), { reply_markup: { inline_keyboard: [[buyButton]] } });
      return;
    }
    return void (await send(chatId, t.buyIntro(account), { reply_markup: packKeyboard() }));
  }

  const buy = /^buy:([A-Za-z0-9]{1,16})$/.exec(cb.data || "");
  if (buy) {
    const pack = findPack(buy[1]);
    if (!pack) return void (await answer({ text: "This offer is no longer available. Use /buy.", show_alert: true }));
    await answer();
    // Telegram Stars: currency "XTR", no provider_token, exactly one price line.
    return void (await tg("sendInvoice", {
      chat_id: chatId,
      title: `${pack.downloads} book downloads`,
      description: `${pack.downloads} PDF/EPUB download credits for ${brand()}. Credits never expire.`,
      payload: payloadFor(pack),
      currency: "XTR",
      prices: [{ label: `${pack.downloads} downloads`, amount: pack.stars }],
    }));
  }

  const m = /^d:(\d+):([pe])$/.exec(cb.data || "");
  if (!m) return void (await answer());

  const limit = await downloadLimit(event, chatId);
  if (!limit.ok) return void (await answer({ text: `⏳ Please wait ${limit.retryAfterSec}s`, show_alert: true }));
  await answer({ text: "⏳ Preparing your file…" });

  const session = await loadResults(event, chatId);
  const idx = Number(m[1]);
  const book = session && session.results[idx];
  const format = m[2] === "e" ? "epub" : "pdf";
  if (!book || !(format === "epub" ? book.epub : book.pdf)) return void (await send(chatId, t.expired));

  const res = await deliver(event, chatId, book, format);
  if (res.status === "paywall") {
    await track(event, { paywall: 1 });
    await setPending(event, chatId, idx, format);
    await send(chatId, t.paywall(), { reply_markup: packKeyboard() });
  }
}

// Reserve one download from the allowance (unless the file's host is exempt), send the file, and
// give the allowance back if anything goes wrong. Returns { status }.
async function deliver(event, chatId, book, format) {
  const url = format === "epub" ? book.epub : book.pdf;
  const exempt = isFreeUrl(url);
  let reservation = null;
  if (!exempt) {
    reservation = await reserveDownload(event, chatId);
    if (!reservation.ok) return { status: "paywall" };
  }
  const giveBack = () => (reservation ? releaseDownload(event, chatId, reservation.kind).catch((e) => console.error("release failed:", e.message)) : null);

  const status = await send(chatId, t.preparing(book, format)).catch(() => null);
  const statusId = status && status.message_id;
  await tg("sendChatAction", { chat_id: chatId, action: "upload_document" }).catch(() => {});

  let res;
  try {
    res = await sendBookDocument(chatId, book, format);
  } catch (e) {
    console.error("Sending book failed:", e.message);
    await giveBack();
    await track(event, { dlFail: 1, dlError: 1 });
    await edit(chatId, statusId, t.failed, { reply_markup: linkKeyboard(url, "⬇️ Download directly") }).catch(() => {});
    return { status: "error" };
  }
  if (!res.ok) {
    await giveBack();
    await track(event, { dlFail: 1, [res.reason === "too_large" ? "dlTooLarge" : "dlNotBook"]: 1 });
    if (res.reason === "too_large") {
      await edit(chatId, statusId, t.tooLarge, { reply_markup: linkKeyboard(url, "⬇️ Download directly") }).catch(() => {});
    } else {
      await edit(chatId, statusId, t.notBook, { reply_markup: linkKeyboard(url, "🔗 Open the link") }).catch(() => {});
    }
    return { status: res.reason };
  }

  await Promise.all([
    track(event, {
      dl: 1,
      [format === "epub" ? "dlEpub" : "dlPdf"]: 1,
      [exempt ? "dlExempt" : reservation.kind === "credit" ? "dlCredit" : "dlFree"]: 1,
      [`src:${book.source}`]: 1,
    }),
    bumpTop(event, "books", bookLabel(book)),
  ]);
  await edit(chatId, statusId, exempt ? t.sentFree(format, res.bytes) : t.sent(format, res.bytes, await getAccount(event, chatId))).catch(() => {});
  return { status: "sent" };
}

// ---------------------------------------------------------------- payments

async function onPayment(event, message) {
  const sp = message.successful_payment;
  const chatId = message.chat.id;
  const userId = (message.from && message.from.id) || chatId;
  const charge = sp.telegram_payment_charge_id;
  const pack = packFromPayload(sp.invoice_payload);

  if (sp.currency !== "XTR" || !pack || sp.total_amount !== pack.stars) {
    console.error("Unrecognised payment:", JSON.stringify(sp));
    await notifyAdmin(`⚠️ Unrecognised Stars payment\n👤 User ${userId}\n💵 ${sp.total_amount} ${sp.currency}\n📦 Payload: "${sp.invoice_payload}"\n🧾 Charge: ${charge}`);
    return void (await send(chatId, t.payProblem(charge)));
  }

  const r = await creditPurchase(event, { userId, chargeId: charge, downloads: pack.downloads, stars: pack.stars });
  if (r.duplicate) return; // Telegram re-sent an update we already processed
  await track(event, { pay: 1, stars: pack.stars });
  await send(chatId, t.paid(pack.downloads, charge, r.account));
  await notifyAdmin(`💰 New sale\n⭐ ${pack.stars} · ${pack.downloads} downloads\n👤 User ${userId}\n🧾 Charge: ${charge}`);

  const pending = await takePending(event, chatId);
  if (pending) await deliver(event, chatId, pending.book, pending.format);
}

// ---------------------------------------------------------------- admin commands (ADMIN_CHAT_ID only)

// /refund <charge_id>: returns the Stars via Telegram and takes the credits back.
async function onRefund(event, chatId, arg) {
  if (!isAdmin(chatId)) return void (await send(chatId, t.help()));
  const id = arg.split(/\s+/)[0];
  if (!id) return void (await say(chatId, "Usage: /refund <charge_id>"));
  const rec = await getCharge(event, id);
  if (!rec) return void (await say(chatId, "Unknown charge id."));
  if (rec.refunded) return void (await say(chatId, "That payment was already refunded."));
  try {
    await tg("refundStarPayment", { user_id: rec.userId, telegram_payment_charge_id: id });
  } catch (e) {
    return void (await say(chatId, `Telegram refused the refund: ${e.message}`));
  }
  const r = await markRefunded(event, id);
  await track(event, { refund: 1, refundStars: rec.stars });
  await say(chatId, `↩️ Refunded ${rec.stars}⭐ to user ${rec.userId}.\nTheir paid credits are now ${r.account.credits}.`);
  await send(rec.userId, t.refunded(rec.stars)).catch(() => {});
}

// /grant <user_id> <credits> — handy for testing without spending real Stars.
async function onGrant(event, chatId, arg) {
  if (!isAdmin(chatId)) return void (await send(chatId, t.help()));
  const [uid, n] = arg.split(/\s+/);
  const credits = Number(n);
  if (!/^\d+$/.test(uid || "") || !Number.isInteger(credits) || Math.abs(credits) > 1000) {
    return void (await say(chatId, "Usage: /grant <user_id> <credits>"));
  }
  const a = await grantCredits(event, uid, credits);
  await say(chatId, `🎁 User ${uid} now has ${a.credits} paid credits.`);
}

// /stats → summary (today / 7 days / 30 days / all time); /stats top → most requested.
async function onStats(event, chatId, arg) {
  if (!isAdmin(chatId)) return void (await send(chatId, t.help()));
  const report = await getReport(event);
  const text = arg.trim().toLowerCase() === "top" ? formatTop(report) : formatReport(report);
  await say(chatId, text.slice(0, 4000)); // Telegram's limit is 4096 characters
}

// /setup — publishes the bot's public profile through the Bot API, so nothing has to be typed
// into BotFather by hand: the "/" command menu (plus extra admin commands, visible only to you,
// and /book for the discussion group),
// the description shown on an empty chat, and the short description shown on the bot's profile.
async function onSetup(chatId) {
  if (!isAdmin(chatId)) return void (await send(chatId, t.help()));
  const commands = [
    { command: "start", description: "Start" },
    { command: "help", description: "How it works" },
    { command: "balance", description: "Free downloads and credits" },
    { command: "buy", description: "Buy download credits (Telegram Stars)" },
    { command: "paysupport", description: "Payment help" },
  ];
  const adminCommands = [
    ...commands,
    { command: "stats", description: "Usage statistics (admin)" },
    { command: "refund", description: "Refund a payment (admin)" },
    { command: "grant", description: "Grant credits (admin)" },
    { command: "setup", description: "Update bot profile (admin)" },
  ];
  const lines = ["🛠 Bot profile setup"];
  const attempt = async (label, fn) => {
    try {
      await fn();
      lines.push(`✅ ${label}`);
    } catch (e) {
      lines.push(`❌ ${label}: ${e.message}`);
    }
  };
  await attempt("Command menu", () => tg("setMyCommands", { commands }));
  await attempt("Admin command menu (only you)", () => tg("setMyCommands", { commands: adminCommands, scope: { type: "chat", chat_id: Number(chatId) } }));
  await attempt("Group menu (/book in your comments)", () =>
    tg("setMyCommands", { commands: [{ command: "book", description: "Find a book: /book Title - Author" }], scope: { type: "all_group_chats" } })
  );
  await attempt("Description", () => tg("setMyDescription", { description: t.profileDescription().slice(0, 512) }));
  await attempt("Short description", () => tg("setMyShortDescription", { short_description: t.profileShort().slice(0, 120) }));
  await say(chatId, lines.join("\n"));
}
