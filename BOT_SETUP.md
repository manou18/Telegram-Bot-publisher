# بوت البحث عن الكتب (تفاعلي) — الإعداد

**البوت مخصص للكتب الإنجليزية فقط.** المستخدم يرسل: `Title - Author` (بالإنجليزية) ← البوت يبحث في المكتبات المفتوحة ← يعرض النتائج بأزرار PDF / EPUB ← يرسل الملف.

## الملفات الجديدة / المعدّلة
| الملف | الدور |
|---|---|
| `netlify/functions/telegram-webhook.js` (معدّل) | يمرّر رسائل المحادثات الخاصة والضغط على الأزرار إلى العامل الخلفي. باقي وظائفه (التفاعلات/التعليقات) كما هي |
| `netlify/functions/bot-worker-background.js` (جديد) | Background Function: البحث + الإرسال (حتى 15 دقيقة بدل 10 ثوانٍ) |
| `netlify/lib/bookBot.js` (جديد) | تحليل الرسالة، البحث المتوازي في المصادر، الترتيب، دمج التكرار، تنزيل/فحص/رفع الملف |
| `netlify/lib/botSession.js` (جديد) | حفظ آخر نتائج لكل محادثة + تحديد المعدّل (Netlify Blobs) |

المصادر المستخدمة هي نفسها الموجودة في `sources.js` (كلها قانونية): Project Gutenberg، Open Library/Internet Archive (غير المقيّدة)، Google Books (ملكية عامة)، Internet Archive texts، OAPEN، DOAB.

## متغيرات البيئة (Netlify)
- `BOT_TOKEN` — موجود أصلًا.
- `TELEGRAM_WEBHOOK_SECRET` — **إلزامي الآن**: يحمي الـ webhook والعامل الخلفي.
- `SITE_URL` — اختياري (مثال `https://yoursite.netlify.app`) إن لم يعمل الاكتشاف التلقائي.

## ربط الـ webhook (مرة واحدة)
```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<YOUR_SITE>.netlify.app/api/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","message_reaction_count","callback_query","pre_checkout_query"]'
```
لاحظ: `callback_query` (أزرار PDF/EPUB) و`pre_checkout_query` (الدفع بالنجوم — تيليغرام يمنح البوت 10 ثوانٍ فقط للموافقة، لذلك يُجاب مباشرة داخل `telegram-webhook.js`).

في BotFather: `/setcommands` ثم الصق:
```
start - Start
help - How it works
balance - Free downloads and credits
buy - Buy download credits (Telegram Stars)
paysupport - Payment help
```

## حدود يجب معرفتها
- تيليغرام يسمح للبوتات برفع ملفات حتى 50 ميغابايت؛ الأكبر يُرسل كرابط.
- 12 عملية بحث و20 تنزيلًا في الساعة لكل محادثة (عدّلها في `botSession.js`).
- Netlify المجاني له حدود على الاستدعاءات ووقت التنفيذ؛ راقب الاستهلاك إذا كثر المستخدمون.
- الكتب الحديثة المحمية بحقوق النشر لن تظهر غالبًا — هذا مقصود.

## تخصيص اللغة الإنجليزية (كيف يعمل)
- استعلام بلا أي حرف لاتيني (عربي/روسي/صيني…) ← رد ودّي يطلب العنوان بالإنجليزية، دون بحث ودون استهلاك الحصة.
- التصفية على مرحلتين: (1) طلب اللغة من المصدر حيث يدعمها (Gutendex `languages=en`، Open Library `language:eng`)، ثم فحص وسم اللغة في كل سجل (`en`/`eng`/`English`) لكل المصادر؛ (2) بعد جلب الملف يُفحص وسم اللغة في archive.org.
- سجل بلا وسم لغة يُقبل فقط إذا كان عنوانه ومؤلفه بأحرف لاتينية.
- للتوسّع لاحقًا للغات أخرى عدّل `ENGLISH_CODE` و`buildQueryFor` و`gutendexEnglishUrl` في `netlify/lib/bookBot.js`.
- **كل رسائل البوت بالإنجليزية فقط** مهما كانت لغة تيليغرام لدى المستخدم (الكائن `t` في `netlify/functions/bot-worker-background.js`).

---

# النموذج المدفوع: 3 تحميلات مجانية شهريًا ثم نجوم تيليغرام

## كيف يعمل
- **البحث دائمًا مجاني.** يُحتسب فقط الملف الذي **وصل فعلًا** للمستخدم؛ إذا فشل الإرسال أو كان الملف أكبر من 50MB أو ليس كتابًا صالحًا، لا يُخصم شيء.
- كل مستخدم: `BOT_FREE_PER_MONTH` (افتراضي 3) تحميلات مجانية كل شهر ميلادي (UTC)، تتجدد في الأول من الشهر. بعدها تُستهلك **الأرصدة المدفوعة** (لا تنتهي صلاحيتها وتنتقل من شهر لآخر).
- عند نفاد الرصيد يظهر عرض الباقات؛ يُحفظ الكتاب الذي طلبه المستخدم وعند نجاح الدفع **يُرسل تلقائيًا**.
- الدفع: `sendInvoice` بعملة `XTR` (بدون provider token). عند الدفع الناجح يُضاف الرصيد مرة واحدة فقط حتى لو أعاد تيليغرام إرسال التحديث (مفتاح فريد = `telegram_payment_charge_id`).

## الأسعار المقترحة (الافتراضية في الكود)
| الباقة | النجوم | لكل تحميل | يدفع المشتري (تقريبًا)* | تستلم أنت (تقريبًا)* |
|---|---|---|---|---|
| 10 تحميلات | 40 ⭐ | 4.0 ⭐ | ~$0.80 | ~$0.52 |
| 30 تحميلًا | 100 ⭐ | 3.3 ⭐ | ~$2.00 | ~$1.30 |
| 100 تحميل | 300 ⭐ | 3.0 ⭐ | ~$6.00 | ~$3.90 |

\* تقدير: سعر شراء النجمة داخل التطبيق ≈ $0.02، وما تستلمه عند السحب ≈ $0.013 للنجمة (يتغير). الحد الأدنى للسحب 1000 نجمة (~$13) ويُحجز كل رصيد جديد 21 يومًا، ويُدفع بعملة TON عبر Fragment.

لتغيير الأسعار دون تعديل الكود: متغير البيئة `BOT_STAR_PACKS`، مثال:
`[{"id":"p10","downloads":10,"stars":40},{"id":"p30","downloads":30,"stars":100}]`
(`id` حروف/أرقام حتى 16، النجوم بين 1 و10000).

## متغيرات البيئة الجديدة
| المتغير | الوظيفة |
|---|---|
| `BOT_FREE_PER_MONTH` | عدد التحميلات المجانية شهريًا (افتراضي 3) |
| `BOT_STAR_PACKS` | باقات النجوم (JSON) |
| `BOT_FREE_HOSTS` | مواقع تحميل لا تُحتسب ولا تُدفع. **افتراضيًا `gutenberg.org`** (انظر التنبيه القانوني). اتركه فارغًا `""` لتحصيل ثمن كل شيء |
| `BOT_DISABLED_SOURCES` | أرقام مصادر (من `sources.js`) لإيقافها، مثل `4,6` لإيقاف OAPEN وDOAB |
| `ADMIN_CHAT_ID` | (موجود أصلًا) يفعّل أوامر المشرف ويرسل لك إشعار كل عملية بيع |
| `SUPPORT_CONTACT` | جهة الدعم التي تظهر في `/paysupport` (مثل `@your_username`) |

## أوامر
- المستخدم: `/balance` `/buy` `/paysupport`
- المشرف فقط (`ADMIN_CHAT_ID`): `/refund <charge_id>` يعيد النجوم عبر تيليغرام ويسحب الرصيد الممنوح، و`/grant <user_id> <n>` لمنح رصيد (مفيد للاختبار دون إنفاق نجوم حقيقية)، و`/stats` و`/stats top` لإحصائيات المالك (انظر أدناه).
- تيليغرام يشترط أن يدعم البوت الذي يبيع بالنجوم أمر `/paysupport`.

## تنبيهات قانونية (مهم قبل التشغيل الفعلي)
- **Project Gutenberg**: ترخيصه (البند 1.E.8) يسمح بتحصيل رسوم على الوصول إلى ملفاته أو توزيعها **فقط** مع دفع 20% من الأرباح الإجمالية للمؤسسة صاحبة العلامة، وردّ الأموال في حالات محددة. لذلك ملفات gutenberg.org **مستثناة افتراضيًا** من الحصة. إن أردت تحصيل ثمنها فاقرأ الترخيص وقرّر (`BOT_FREE_HOSTS=""`).
- **المصادر الأخرى** (archive.org، Google Books، OAPEN، DOAB): لم أتحقق من شروطها للاستخدام التجاري. بعض الكتب في OAPEN/DOAB/IA تحمل تراخيص Creative Commons غير تجارية (NC)، وقد يعني تحصيل رسوم على إيصالها مخالفة للترخيص. راجع الشروط، أو استثنِ المصدر (`BOT_FREE_HOSTS` أو `BOT_DISABLED_SOURCES`).
- نموذج «الدفع مقابل الخدمة لا الكتب» لا يلغي هذه الالتزامات. وقد تنطبق قوانين حماية المستهلك والضرائب في بلدك على مبيعات النجوم — استشر مختصًا.

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
