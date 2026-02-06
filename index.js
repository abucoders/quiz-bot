require("dotenv").config();
const { Telegraf, Scenes, session, Markup } = require("telegraf");
const mongoose = require("mongoose");
const Quiz = require("./models/Quiz");
const Result = require("./models/Result");
const User = require("./models/User");
const createQuizScene = require("./scenes/createQuizScene");
const importQuizScene = require("./scenes/importQuizScene"); // Yangi sahnani ulash
const adminScene = require("./scenes/adminScene");
const http = require("http");
const {
  editTitleScene,
  editDescScene,
  editTimerScene,
  editShuffleScene,
  addQuestionScene,
} = require("./scenes/editQuizScenes");
const aiQuizScene = require("./scenes/aiQuizScene");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot ishlayapti!");
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// MongoDB ulanishi
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error(err));

const bot = new Telegraf(process.env.BOT_TOKEN);

// SAHNALARNI RO'YXATGA OLISH (Stage ichiga qo'shing)
const stage = new Scenes.Stage([
  createQuizScene,
  importQuizScene,
  adminScene,
  // YANGI SAHNALAR:
  editTitleScene,
  editDescScene,
  editTimerScene,
  editShuffleScene,
  addQuestionScene,
  aiQuizScene,
]);

bot.use(session());

// ===================================================
// 🛑 GLOBAL HIMOYA (ANT-STUCK)
// ===================================================
// Bu kod user sahnada qolib ketsa ham, /stop yoki /start bossa qutqaradi
bot.use(async (ctx, next) => {
  if (ctx.message && ctx.message.text) {
    const text = ctx.message.text;

    // Agar buyruq /start yoki /stop bo'lsa
    if (text === "/start" || text === "/stop") {
      // 1. SAHNADAN MAJBURAN CHIQARISH
      // Agar sessiyada sahna bo'lsa, uni o'chirib tashlaymiz
      if (ctx.session && ctx.session.__scenes) {
        delete ctx.session.__scenes;
      }

      // 2. AGAR /STOP BO'LSA - O'YINLARNI HAM TO'XTATAMIZ VA MENYU BERAMIZ
      if (text === "/stop") {
        const userId = ctx.from.id;

        // A) Lichka o'yinini to'xtatish
        if (activeGames.has(userId)) {
          const game = activeGames.get(userId);
          if (game.timer) clearTimeout(game.timer);
          activeGames.delete(userId);
        }

        // B) Guruh o'yinini to'xtatish (Faqat admin bo'lsa)
        if (ctx.chat.type !== "private" && groupGames.has(ctx.chat.id)) {
          // Guruhda bo'lsa, faqat admin to'xtata oladi deb tekshirish shart emas,
          // chunki bu "shaxsiy" stop. Lekin guruh o'yinini buzmaslik uchun
          // shunchaki "keyingi qadamga" o'tkazmaymiz va javob beramiz.
          // Agar guruhni to'liq to'xtatmoqchi bo'lsangiz, bu yerga admin tekshiruvi kerak.
        }

        // C) BOSH MENYUNI CHIQARISH (Faqat lichkada)
        if (ctx.chat.type === "private") {
          await ctx.reply(
            "🛑 <b>Jarayon to'xtatildi.</b>\n\nBosh menyudasiz:",
            {
              parse_mode: "HTML",
              ...Markup.keyboard([
                ["Yangi test tuzish", "📥 Matn orqali yuklash"],
                ["Testlarimni ko'rish", "👤 Mening profilim"],
              ]).resize(),
            }
          );
          return; // Kod shu yerda tugaydi, boshqa joyga o'tmaydi
        }
      }
    }
  }
  // Boshqa barcha holatlarda davom etamiz
  return next();
});

// ===================================================
// 🔒 O'YIN VAQTIDA BOSHQA BUYRUQLARNI BLOKLASH
// ===================================================
bot.use(async (ctx, next) => {
  // Faqat shaxsiy chatda va user o'yinda bo'lsa
  if (
    ctx.chat?.type === "private" &&
    ctx.from?.id &&
    activeGames.has(ctx.from.id)
  ) {
    // 1. Texnik yangilanishlarga (Poll Answer) ruxsat beramiz (aks holda o'yin ishlamaydi)
    if (ctx.pollAnswer) return next();

    // 2. Tugmalarga (Callback) ruxsat beramiz (masalan, "stop" tugmasi uchun)
    if (ctx.callbackQuery) return next();

    // 3. Matnli xabarlarni tekshiramiz
    if (ctx.message?.text) {
      const text = ctx.message.text;
      // Faqat /stop va /start ga ruxsat
      if (text === "/stop" || text === "/start") return next();
    }

    // ⛔️ Qolgan hamma narsani bloklaymiz va ogohlantiramiz
    return ctx.reply(
      "⚠️ <b>Siz hozir test ishlayapsiz!</b>\n\nBoshqa buyruqlar ishlamaydi. Testni tugating yoki /stop ni bosing.",
      { parse_mode: "HTML" }
    );
  }

  return next();
});

bot.use(stage.middleware());

// --- XOTIRA (RAM) ---
const activeGames = new Map();
const groupGames = new Map();

// ===================================================
// 🔥 MAJBURIY OBUNA (MIDDLEWARE)
// ===================================================

const checkSubscription = async (ctx, next) => {
  // 1. Agar kanal sozlanmagan bo'lsa, tekshirmaymiz
  const channel = process.env.REQUIRED_CHANNEL;
  if (!channel) return next();

  // 2. Agar bu "Tekshirish" tugmasi bo'lsa, o'tkazib yuboramiz (pastda alohida handler bor)
  if (ctx.callbackQuery && ctx.callbackQuery.data === "check_sub")
    return next();

  // 3. User ID ni aniqlaymiz
  const userId = ctx.from?.id;
  if (!userId) return next();

  try {
    // Telegramdan user statusini so'raymiz
    const member = await ctx.telegram.getChatMember(channel, userId);

    // Ruxsat berilgan statuslar: creator (yaratuvchi), administrator, member (a'zo)
    if (["creator", "administrator", "member"].includes(member.status)) {
      return next(); // A'zo ekan, ruxsat beramiz!
    } else {
      // ⛔️ A'zo emas!
      // Agar guruhda bo'lsa, shunchaki javob bermay qo'ya qolamiz (spam bo'lmasligi uchun)
      // Lekin lichkada bo'lsa, majburiy obuna xabarini chiqaramiz.
      if (ctx.chat.type !== "private") return;

      const channelLink = `https://t.me/${channel.replace("@", "")}`;

      await ctx.reply(
        `⚠️ <b>Botdan foydalanish uchun kanalimizga a'zo bo'ling!</b>\n\n` +
          `A'zo bo'lganingizdan so'ng <b>"✅ Tasdiqlash"</b> tugmasini bosing.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.url("📢 Kanalga a'zo bo'lish", channelLink)],
            [Markup.button.callback("✅ Tasdiqlash", "check_sub")],
          ]),
        }
      );
      // Kod shu yerda to'xtaydi, next() chaqirilmaydi.
    }
  } catch (err) {
    console.error("Obuna tekshirishda xatolik:", err);
    // Agar bot kanalda admin bo'lmasa yoki xato chiqsa, userga xalaqit bermaymiz
    return next();
  }
};

// Middlewareni ulash (Barcha komandalardan oldin ishlaydi)
bot.use(checkSubscription);

// "✅ Tasdiqlash" tugmasi bosilganda
bot.action("check_sub", async ctx => {
  const channel = process.env.REQUIRED_CHANNEL;
  try {
    const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
    if (["creator", "administrator", "member"].includes(member.status)) {
      await ctx.deleteMessage(); // Eski xabarni o'chiramiz
      await ctx.reply(
        "✅ <b>Rahmat! Obuna tasdiqlandi.</b>\nEndi bemalol foydalanishingiz mumkin. /start ni bosing.",
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.answerCbQuery("❌ Siz hali kanalga a'zo bo'lmadingiz!", {
        show_alert: true,
      });
    }
  } catch (e) {
    await ctx.answerCbQuery("Xatolik yuz berdi. Keyinroq urinib ko'ring.");
  }
});

// ===================================================
// 👑 ADMIN PANEL
// ===================================================

// 1. STATISTIKA (/admin_stats)
bot.command("admin_stats", async ctx => {
  // Faqat admin ishlata olsin
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const userCount = await User.countDocuments();
  const quizCount = await Quiz.countDocuments();
  const resultCount = await Result.countDocuments(); // Agar Result model bo'lsa

  await ctx.reply(
    `📊 <b>BOT STATISTIKASI:</b>\n\n` +
      `👤 Foydalanuvchilar: <b>${userCount}</b> ta\n` +
      `📝 Tuzilgan testlar: <b>${quizCount}</b> ta\n` +
      `✅ Yechilgan testlar: <b>${resultCount}</b> ta`,
    { parse_mode: "HTML" }
  );
});

// 2. XABAR TARQATISH (/broadcast)
bot.command("broadcast", ctx => {
  // Faqat admin ishlata olsin
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  ctx.scene.enter("admin_broadcast");
});

// ===================================================
// 💰 ADMIN: COIN BERISH VA OLISH (YANGILANGAN)
// ===================================================
bot.command("addcoin", async ctx => {
  // 1. Faqat ADMIN ishlata olsin
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  // 2. Buyruqni bo'laklarga ajratamiz
  const args = ctx.message.text.split(" ");
  const targetId = Number(args[1]); // ID
  const amount = Number(args[2]); // Miqdor

  // 3. Tekshiruv
  if (!targetId || !amount) {
    return ctx.reply(
      "❌ <b>Xato format!</b>\n\nIshlatish: <code>/addcoin ID MIQDOR</code>\nMasalan: <code>/addcoin 123456789 100</code> (Berish)\nYoki: <code>/addcoin 123456789 -50</code> (Olish)",
      { parse_mode: "HTML" }
    );
  }

  try {
    // 4. Userni topib, coin qo'shamiz
    const user = await User.findOneAndUpdate(
      { telegramId: targetId },
      { $inc: { coins: amount } },
      { new: true }
    );

    if (!user) {
      return ctx.reply("❌ Bunday ID ga ega foydalanuvchi topilmadi.");
    }

    // 5. Adminga hisobot (har doim bir xil)
    await ctx.reply(
      `✅ <b>Muvaffaqiyatli bajarildi!</b>\n\n👤 User: ${user.firstName}\n🔄 O'zgarish: <b>${amount}</b> Coin\n💰 Jami: <b>${user.coins}</b> Coin`,
      { parse_mode: "HTML" }
    );

    // 6. FOYDALANUVCHIGA XABAR (MANTIQNI AJRATAMIZ)
    if (amount > 0) {
      // --- A) AGAR QO'SHILGAN BO'LSA (SOVG'A) ---
      await bot.telegram.sendMessage(
        targetId,
        `🎁 <b>TABRIKLAYMIZ!</b>\n\nAdmin tomonidan sizga <b>${amount} Coin</b> sovg'a qilindi! 🥳\n\n💰 Hozirgi balansingiz: <b>${user.coins} Coin</b>`,
        { parse_mode: "HTML" }
      );
    } else {
      // --- B) AGAR AYIRILGAN BO'LSA (JARIMA) ---
      // Math.abs(-40) -> 40 ga aylantiradi (minusni olib tashlaydi)
      const positiveAmount = Math.abs(amount);

      await bot.telegram.sendMessage(
        targetId,
        `🚫 <b>JARIMA!</b>\n\nAdmin tomonidan hisobingizdan <b>${positiveAmount} Coin</b> olib tashlandi. 📉\n\n💰 Hozirgi balansingiz: <b>${user.coins} Coin</b>`,
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    console.error(err);
    ctx.reply("Xatolik yuz berdi.");
  }
});

// ===================================================
// 🛑 STOP KOMANDASI (ADMIN VA OVOZ BERISH ORQALI)
// ===================================================
bot.command("stop", async ctx => {
  const userId = ctx.from.id;

  // 1. LICHKA (YAKKAXON O'YIN) UCHUN
  if (ctx.chat.type === "private") {
    if (activeGames.has(userId)) {
      const game = activeGames.get(userId);
      if (game.timer) clearTimeout(game.timer);
      activeGames.delete(userId);
      return ctx.reply("✅ <b>Test to'xtatildi.</b>", { parse_mode: "HTML" });
    } else {
      return ctx.reply("Sizda hozir aktiv test yo'q.");
    }
  }

  // 2. GURUH UCHUN
  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    const game = groupGames.get(ctx.chat.id);

    // Agar o'yin bo'lmasa
    if (!game) {
      return ctx.reply("Guruhda faol o'yin yo'q.");
    }

    // Admin ekanligini tekshiramiz
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    const isAdmin = ["creator", "administrator"].includes(member.status);

    // --- A) AGAR ADMIN BO'LSA (DARHOL TO'XTATADI) ---
    if (isAdmin) {
      if (game.timer) clearTimeout(game.timer);
      groupGames.delete(ctx.chat.id);
      return ctx.reply(
        "🛑 <b>Admin tomonidan o'yin majburiy to'xtatildi.</b>",
        { parse_mode: "HTML" }
      );
    }

    // --- B) AGAR ODDIY USER BO'LSA (OVOZ BERISH BOSHLANADI) ---

    // Agar ovoz berish allaqachon ketayotgan bo'lsa
    if (game.stopVoteActive) {
      return ctx.reply(
        "⚠️ O'yinni to'xtatish bo'yicha ovoz berish jarayoni ketmoqda! Tepada ovoz bering."
      );
    }

    // O'yinchilar sonini tekshiramiz
    const playerCount = game.players.size;
    if (playerCount === 0) {
      // O'yinchi yo'q bo'lsa, shunchaki to'xtatvoramiz
      if (game.timer) clearTimeout(game.timer);
      groupGames.delete(ctx.chat.id);
      return ctx.reply("🛑 O'yin to'xtatildi.");
    }

    // Ovoz berishni boshlaymiz
    game.stopVoteActive = true;
    game.stopVotes = new Set(); // Ovoz berganlar ro'yxati
    // Kerakli ovozlar soni (50% dan ko'p bo'lishi kerak)
    // Masalan: 10 kishi bo'lsa -> 6 ta ovoz kerak. 3 kishi bo'lsa -> 2 ta.
    game.votesNeeded = Math.floor(playerCount / 2) + 1;

    // Ovoz berish tugmasini chiqaramiz
    await ctx.reply(
      `🛑 <b>O'yinni to'xtatish taklif qilindi!</b>\n\n` +
        `Agar <b>${game.votesNeeded}</b> kishi rozi bo'lsa, o'yin to'xtatiladi.\n` +
        `Hozirgi ovozlar: <b>0 / ${game.votesNeeded}</b>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              `✋ Ha, to'xtatilsin (0/${game.votesNeeded})`,
              "vote_stop_game"
            ),
          ],
        ]),
      }
    );
  }
});

// ===================================================
// 🔍 INLINE MODE (YANGILANGAN - 100% ISHLAYDI)
// ===================================================

// ===================================================
// 🔍 INLINE MODE (YANGILANGAN - 2 XIL VARIANT BILAN)
// ===================================================

bot.on("inline_query", async ctx => {
  const query = ctx.inlineQuery.query;
  let quizzes = [];

  try {
    if (query) {
      if (query.startsWith("start=")) {
        const quizId = query.split("=")[1];
        if (mongoose.Types.ObjectId.isValid(quizId)) {
          const quiz = await Quiz.findById(quizId);
          if (quiz) quizzes = [quiz];
        }
      } else {
        quizzes = await Quiz.find({
          title: { $regex: query, $options: "i" },
        }).limit(20);
      }
    } else {
      quizzes = await Quiz.find().sort({ createdAt: -1 }).limit(20);
    }

    const results = [];

    quizzes.forEach(q => {
      // 1-VARIANT: ULASHISH UCHUN (Chiroyli kartochka)
      // Bu variantni do'stingizga yuborsangiz chiroyli ko'rinadi
      results.push({
        type: "article",
        id: q._id.toString() + "_share", // ID unikal bo'lishi kerak
        title: `📤 Ulashish: ${q.title}`,
        description: `${q.questions.length} savol • Do'stga yuborish uchun`,
        thumb_url: "https://cdn-icons-png.flaticon.com/512/2958/2958791.png", // Share icon
        input_message_content: {
          message_text:
            `📄 <b>${q.title}</b>\n` +
            `🖊 Savollar: ${q.questions.length} ta\n` +
            `⏱ Vaqt: ${q.settings.time_limit} soniya\n\n` +
            `👇 Testni ishlash uchun bosing:`,
          parse_mode: "HTML",
        },
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🚀 Testni boshlash",
                url: `https://t.me/${ctx.botInfo.username}?start=${q._id}`,
              },
            ],
          ],
        },
      });

      // 2-VARIANT: GURUHDA BOSHLASH (Buyruq)
      // Bu variantni guruhga yuborsangiz, srazi o'yin ochiladi
      results.push({
        type: "article",
        id: q._id.toString() + "_group",
        title: `📢 Guruhda boshlash: ${q.title}`,
        description: "Guruhga yuborilsa, srazi Lobbi ochiladi",
        thumb_url: "https://cdn-icons-png.flaticon.com/512/3407/3407024.png", // Megaphone icon
        input_message_content: {
          message_text: `/start_lobby_${q._id}`,
        },
      });
    });

    await ctx.answerInlineQuery(results, { cache_time: 0 });
  } catch (err) {
    console.error("Inline Query Xato:", err);
  }
});

// ===================================================
// 1. START VA MENYU
// ===================================================

bot.start(async ctx => {
  try {
    const payload = ctx.startPayload; // start dan keyingi yozuv (masalan: ref_12345 yoki quiz_id)
    let user = await User.findOne({ telegramId: ctx.from.id });

    // ----------------------------------------------------
    // 1-QISM: FOYDALANUVCHINI RO'YXATGA OLISH
    // ----------------------------------------------------
    if (!user) {
      // Referal ekanligini tekshiramiz
      const isReferral = payload && payload.startsWith("ref_");

      // Yangi user yaratamiz
      user = await User.create({
        telegramId: ctx.from.id,
        firstName: ctx.from.first_name,
        username: ctx.from.username,
        // Agar referal bo'lsa 100 coin (50+50), bo'lmasa 50 coin
        coins: isReferral ? 100 : 50,
      });

      // REFERAL MUKOFOTLARI
      if (isReferral) {
        const referrerId = Number(payload.replace("ref_", "")); // ID ni ajratib olamiz

        // O'zini o'zi taklif qilolmasin
        if (referrerId !== ctx.from.id) {
          // A) TAKLIF QILGAN ODAMGA (100 Coin)
          const referrer = await User.findOneAndUpdate(
            { telegramId: referrerId },
            { $inc: { coins: 100 } }
          );

          if (referrer) {
            await bot.telegram.sendMessage(
              referrerId,
              `🎉 <b>Tabriklaymiz!</b>\nSizning havolangiz orqali <b>${ctx.from.first_name}</b> botga qo'shildi.\n💰 <b>Sizga 100 Coin berildi!</b>`,
              { parse_mode: "HTML" }
            );
          }

          // B) YANGI KIRGAN ODAMGA
          await ctx.reply(
            `🎁 <b>Xush kelibsiz!</b>\nDo'stingiz taklifi bilan kirganingiz uchun sizga <b>qo'shimcha bonus</b> berildi! 💰`,
            { parse_mode: "HTML" }
          );
        }
      }
    } else {
      // Agar user oldin bor bo'lsa, ma'lumotini yangilaymiz
      await User.findOneAndUpdate(
        { telegramId: ctx.from.id },
        {
          firstName: ctx.from.first_name,
          username: ctx.from.username,
          lastActive: Date.now(),
        }
      );
    }

    // ----------------------------------------------------
    // 2-QISM: LINK ORQALI TESTNI OCHISH (MUHIM O'ZGARISH)
    // ----------------------------------------------------
    if (payload && !payload.startsWith("ref_")) {
      // A) Agar GURUHDA bo'lsa -> Darhol o'yinni ochamiz
      if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
        return initGroupLobby(ctx, payload);
      }

      // B) Agar LICHKADA bo'lsa -> Prevyu oynasini ko'rsatamiz
      if (ctx.chat.type === "private") {
        const quiz = await Quiz.findById(payload);

        if (!quiz)
          return ctx.reply(
            "❌ Kechirasiz, bu test topilmadi yoki o'chirilgan."
          );

        // Linklar
        const botUsername = ctx.botInfo.username;
        const shareLink = `https://t.me/${botUsername}?start=${quiz._id}`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(quiz.title)}`;

        // Chiroyli ma'lumotnoma matni
        let caption = `📄 <b>${quiz.title}</b>\n`;
        if (quiz.description) caption += `<i>${quiz.description}</i>\n`;
        caption += `\n🔢 Savollar soni: <b>${quiz.questions.length} ta</b>\n`;
        caption += `⏱ Vaqt har biriga: <b>${quiz.settings.time_limit} soniya</b>\n`;
        caption += `👤 Muallif ID: <code>${quiz.creatorId}</code>\n\n`;
        caption += `<i>Testni ishlash uchun quyidagi tugmalardan birini tanlang:</i>`;

        return ctx.reply(caption, {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            // 1-tugma: Testni shu yerda ishlash
            [
              Markup.button.callback(
                "🚀 Testni ishlashni boshlash",
                `start_solo_${quiz._id}`
              ),
            ],

            // 2-tugma: Guruh tanlash uchun
            [
              Markup.button.switchToChat(
                "👥 Guruhda testni boshlash",
                `start=${quiz._id}`
              ),
            ],

            // 3-tugma: Do'stlarga ulashish
            [Markup.button.url("🔗 Testni ulashish", shareUrl)],
          ]),
        });
      }
    }

    // ----------------------------------------------------
    // 3-QISM: ODDIY MENYU (Agar link bo'lmasa)
    // ----------------------------------------------------
    if (ctx.chat.type === "private") {
      await ctx.reply(
        `👋 <b>Asosiy Menyu</b>\n\n` + `Quyidagi bo'limlardan birini tanlang:`,
        {
          parse_mode: "HTML",
          ...Markup.keyboard([
            ["Yangi test tuzish", "📥 Matn orqali yuklash"],
            ["Testlarimni ko'rish", "👤 Mening profilim"],
            ["📸 Rasm orqali test (AI) - NEW"],
          ]).resize(),
        }
      );
    } else {
      await ctx.reply(`👋 Salom! Test ishlash uchun menga lichkada yozing.`);
    }
  } catch (err) {
    console.error("Start Error:", err);
  }
});

// --- MENYU HANDLERS ---
bot.hears("Yangi test tuzish", ctx => ctx.scene.enter("create_quiz"));
bot.hears("📥 Matn orqali yuklash", ctx => ctx.scene.enter("import_quiz"));

// ===================================================
// 📸 AI TEST (PULLIK KIRISH - 130 COIN)
// ===================================================
// ===================================================
// 📸 AI TEST (1-MARTA BEPUL, KEYIN PULLIK)
// ===================================================
// ===================================================
// 📸 AI TEST (TEKSHIRUV VA TASDIQLASH)
// ===================================================
bot.hears("📸 Rasm orqali test (AI) - NEW", async ctx => {
  const userId = ctx.from.id;
  const COST = 130; // Narx

  try {
    let user = await User.findOne({ telegramId: userId });
    if (!user) {
      user = new User({ telegramId: userId, firstName: ctx.from.first_name });
      await user.save();
    }

    // --- 1. BEPUL IMKONIYAT (Buni so'roqsiz o'tkazaveramiz) ---
    if (!user.hasUsedFreeAI) {
      user.hasUsedFreeAI = true;
      await user.save();
      await ctx.reply(
        `🎁 <b>TABRIKLAYMIZ!</b>\n\nSizga <b>BEPUL</b> kirish imkoniyati berildi! 🔥\nAI rejimi ishga tushmoqda...`,
        { parse_mode: "HTML" }
      );
      return ctx.scene.enter("ai_quiz_scene");
    }

    // --- 2. PULLIK IMKONIYATNI TEKSHIRISH ---

    // Agar puli yetmasa
    if (user.coins < COST) {
      const botUsername = ctx.botInfo.username;
      const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent("Do'stim, bu bot daxshat!...")}`;

      return ctx.reply(
        `🚫 <b>Mablag' yetarli emas!</b>\n\n` +
          `Narxi: <b>${COST} Coin</b>\n` +
          `Sizda bor: <b>${user.coins} Coin</b>\n\n` +
          `👇 <b>Pul ishlash uchun do'stlarni taklif qiling:</b>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [
              Markup.button.url(
                "🚀 Do'stlarni taklif qilish (+100 Coin)",
                shareUrl
              ),
            ],
          ]),
        }
      );
    }

    // --- 3. TASDIQLASH SO'ROVI (Puli yetadi, lekin so'raymiz) ---
    await ctx.reply(
      `💸 <b>Xizmat pullik!</b>\n\n` +
        `AI orqali test tuzish narxi: <b>${COST} Coin</b>.\n` +
        `Sizning balansingiz: <b>${user.coins} Coin</b>.\n\n` +
        `Davom ettirib, hisobdan <b>${COST} Coin</b> yechilishiga rozimisiz?`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Ha, roziman", "confirm_ai_pay")], // <--- YANGI TUGMA
          [Markup.button.callback("❌ Yo'q, bekor qilish", "cancel_ai_pay")],
        ]),
      }
    );
  } catch (err) {
    console.error("AI Entry Error:", err);
  }
});

bot.command("bonus", async ctx => {
  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });

  // 24 soat o'tganini tekshirish
  const now = new Date();
  const lastBonus = user.lastBonusDate
    ? new Date(user.lastBonusDate)
    : new Date(0);
  const diffHours = (now - lastBonus) / (1000 * 60 * 60);

  if (diffHours < 24) {
    const waitTime = Math.ceil(24 - diffHours);
    return ctx.reply(
      `⏳ <b>Siz bugungi bonusni olgansiz!</b>\nYana <b>${waitTime} soat</b>dan keyin urinib ko'ring.`,
      { parse_mode: "HTML" }
    );
  }

  // Bonus beramiz (Masalan 20 Coin)
  await User.findOneAndUpdate(
    { telegramId: userId },
    {
      $inc: { coins: 20 },
      lastBonusDate: now,
    }
  );

  ctx.reply(
    `🎁 <b>Kunlik bonus!</b>\nSizga <b>20 Coin</b> berildi. Ertaga yana kiring!`,
    { parse_mode: "HTML" }
  );
});

// MENING PROFILIM
bot.hears("👤 Mening profilim", async ctx => {
  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });

  // Agar user bazada bo'lmasa (xatolik oldini olish uchun)
  const totalScore = user ? user.totalScore : 0;
  const coins = user ? user.coins : 0; // <--- COIN
  const count = user ? user.quizzesSolved : 0;
  const firstName = user ? user.firstName : ctx.from.first_name;

  // Unvonlar
  let rank = "Boshlovchi 👶";
  if (totalScore > 50) rank = "Bilimdon 🧠";
  if (totalScore > 200) rank = "Ekspert 🎓";
  if (totalScore > 500) rank = "Professor 👨‍🏫";
  if (totalScore > 1000) rank = "Afsona 🏆";

  // Referal link yasaymiz
  const botUsername = ctx.botInfo.username;
  const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

  await ctx.reply(
    `👤 <b>SIZNING PROFILINGIZ</b>\n\n` +
      `🆔 ID: <code>${userId}</code>\n` +
      `📝 Ism: <b>${firstName}</b>\n` +
      `🏅 Unvon: <b>${rank}</b>\n\n` +
      `💰 Hamyon: <b>${coins} Coin</b>\n` +
      `⭐️ Umumiy ball: <b>${totalScore}</b>\n` +
      `✅ Yechilgan testlar: <b>${count}</b> ta\n\n` +
      `🔗 <b>Sizning referal havolangiz:</b>\n` +
      `Do'stlarga ulashing va har bir do'stingiz uchun <b>100 Coin</b> oling!\n\n` +
      `👇 Havolani nusxalab oling:\n` +
      `<code>${refLink}</code>`, // Code formatida nusxalash oson bo'ladi
    { parse_mode: "HTML" }
  );
});

// ===================================================
// 📜 TESTLARIMNI KO'RISH (PAGINATSIYA BILAN)
// ===================================================

// Yordamchi funksiya: Ro'yxatni shakllantirish
async function showUserQuizzes(ctx, page = 1) {
  const limit = 5; // Bir sahifada nechta test chiqsin?
  const skip = (page - 1) * limit;
  const userId = ctx.from.id;

  // Bazadan testlarni olamiz
  const totalQuizzes = await Quiz.countDocuments({ creatorId: userId });
  const quizzes = await Quiz.find({ creatorId: userId })
    .sort({ createdAt: -1 }) // Eng yangisi tepada
    .skip(skip)
    .limit(limit);

  if (totalQuizzes === 0) {
    return ctx.reply("Sizda hali tuzilgan testlar yo'q.");
  }

  let msg = `📂 <b>Sizning testlaringiz:</b>\n(Jami: ${totalQuizzes} ta)\n\n`;

  quizzes.forEach((q, index) => {
    // Raqamlash (Umumiy ro'yxat bo'yicha)
    const globalIndex = skip + index + 1;

    // Aralashtirish statusi uchun ikonka
    let shuffleIcon = "⬇️ aralashtirilmaydi";
    if (q.settings.shuffle_questions && q.settings.shuffle_options)
      shuffleIcon = "🔀 barchasi";
    else if (q.settings.shuffle_questions) shuffleIcon = "🔀 savollar";
    else if (q.settings.shuffle_options) shuffleIcon = "🔀 javoblar";

    // Vaqtni chiroyli ko'rsatish
    let timeText = `${q.settings.time_limit} soniya`;
    if (q.settings.time_limit >= 60) {
      timeText = `${Math.floor(q.settings.time_limit / 60)} daqiqa`;
    }

    // Xabar matni (Rasmdagidek format)
    msg += `<b>${globalIndex}. ${q.title}</b> — <i>${q.plays || 0} kishi ishladi</i>\n`;
    msg += `🖊 ${q.questions.length} ta savol • ⏱ ${timeText} • ${shuffleIcon}\n`;
    msg += `/view_${q._id}\n\n`;
  });

  // PAGINATSIYA TUGMALARI
  const totalPages = Math.ceil(totalQuizzes / limit);
  const buttons = [];

  if (totalPages > 1) {
    const row = [];
    // Orqaga tugmasi
    if (page > 1) {
      row.push(Markup.button.callback("⬅️", `my_quizzes_page_${page - 1}`));
    }
    // O'rtadagi raqam
    row.push(Markup.button.callback(`• ${page} / ${totalPages} •`, "noop"));

    // Oldinga tugmasi
    if (page < totalPages) {
      row.push(Markup.button.callback("➡️", `my_quizzes_page_${page + 1}`));
    }
    buttons.push(row);
  }

  // Xabarni yuborish yoki yangilash
  if (ctx.callbackQuery) {
    await ctx.editMessageText(msg, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons),
    });
  } else {
    await ctx.reply(msg, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons),
    });
  }
}

// 1. Menyudan bosilganda (1-sahifa)
bot.hears("Testlarimni ko'rish", ctx => showUserQuizzes(ctx, 1));

// 2. Tugma bosilganda (Keyingi sahifalar)
bot.action(/^my_quizzes_page_(.+)$/, async ctx => {
  const page = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  await showUserQuizzes(ctx, page);
});

// ===================================================
// 💸 TO'LOVNI TASDIQLASH HANDLERI
// ===================================================
bot.action("confirm_ai_pay", async ctx => {
  const userId = ctx.from.id;
  const COST = 130;

  try {
    const user = await User.findOne({ telegramId: userId });

    // Qayta tekshiramiz (balki bu orada pulini ishlatib qo'ygandir)
    if (!user || user.coins < COST) {
      return ctx.answerCbQuery("❌ Mablag' yetarli emas!", {
        show_alert: true,
      });
    }

    // 1. Pulni yechamiz
    await User.findOneAndUpdate(
      { telegramId: userId },
      { $inc: { coins: -COST } }
    );

    // 2. Xabarni o'zgartiramiz (Tugmalarni yo'qotamiz)
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(
      `✅ <b>-${COST} Coin yechildi.</b>\nAI rejimi ishga tushmoqda...`,
      { parse_mode: "HTML" }
    );

    // 3. Sahnaga kirgizamiz
    return ctx.scene.enter("ai_quiz_scene");
  } catch (err) {
    console.error("Pay Confirm Error:", err);
  }
});

// BEKOR QILISH HANDLERI
bot.action("cancel_ai_pay", async ctx => {
  await ctx.deleteMessage().catch(() => {});
  await ctx.reply("❌ Jarayon bekor qilindi. Pulingiz o'z joyida.");
});

// "noop" tugmasi (shunchaki ko'rsatish uchun, bosganda hech narsa qilmaydi)
bot.action("noop", ctx => ctx.answerCbQuery());

// --- TESTNI KO'RISH VA ULASHISH ---
bot.hears(/^\/view_(.+)$/, async ctx => {
  let quizId = ctx.match[1].split("@")[0];

  if (!mongoose.Types.ObjectId.isValid(quizId))
    return ctx.reply("❌ Noto'g'ri ID.");

  const quiz = await Quiz.findById(quizId);
  if (!quiz) return ctx.reply("Test topilmadi.");

  const botUser = ctx.botInfo.username;
  const privateLink = `https://t.me/${botUser}?start=${quiz._id}`;
  const groupLink = `https://t.me/${botUser}?startgroup=${quiz._id}`;

  let statsText = `<b>${quiz.title}</b>\n`;
  if (quiz.description) statsText += `<i>${quiz.description}</i>\n`;
  statsText += `\n🖊 ${quiz.questions.length} ta savol\n`;
  statsText += `⏱ ${quiz.settings.time_limit} soniya\n\n`;
  statsText += `🔗 <b>Ulashish havolasi:</b>\n${privateLink}`;

  await ctx.reply(statsText, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "▶️ Yakkaxon boshlash",
          `start_solo_${quiz._id}`
        ),
      ],
      [Markup.button.url("👥 Guruhda boshlash", groupLink)],
      [Markup.button.callback("📝 Testni tahrirlash", `edit_main_${quiz._id}`)],
      [
        Markup.button.callback("📊 Statistika", `stats_${quiz._id}`),
        Markup.button.callback("🗑 O'chirish", `delete_quiz_${quiz._id}`),
      ],
    ]),
  });
});

// ===================================================
// 🔄 YAKKAXON QAYTA O'YNASH (HIMOYA BILAN)
// ===================================================

bot.action(/^restart_solo_(.+)$/, async ctx => {
  const quizId = ctx.match[1];
  const userId = ctx.from.id;

  // --- 🔥 HIMOYA KODI 🔥 ---
  // Agar foydalanuvchi allaqachon test ishlayotgan bo'lsa,
  // tugmani bosishiga yo'l qo'ymaymiz.
  if (activeGames.has(userId)) {
    return ctx.answerCbQuery(
      "⚠️ Siz allaqachon test ishlayapsiz! Avval uni tugating.",
      { show_alert: true }
    );
  }
  // -------------------------

  await ctx.answerCbQuery("Test qayta yuklanmoqda... 🔄");

  // Xabarni o'chirmaymiz (Sizning talabingiz bo'yicha)
  // await ctx.deleteMessage().catch(() => {});

  return initSoloQuizSession(ctx, quizId);
});

// 2. "Yopish" tugmasi (shunchaki xabarni o'chiradi)
bot.action("delete_msg", async ctx => {
  await ctx.deleteMessage();
});

// ===================================================
// 🔄 GURUHDA QAYTA O'YNASH LOGIKASI
// ===================================================

bot.action(/^restart_group_(.+)$/, async ctx => {
  const quizId = ctx.match[1];
  const chatId = ctx.chat.id;

  // 1. Agar o'yin allaqachon boshlangan bo'lsa (boshqa birov bosib ulgursa)
  if (groupGames.has(chatId)) {
    return ctx.answerCbQuery("O'yin allaqachon ochilgan! Qo'shiling.", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery("Lobbi qayta ochilmoqda...");

  // 2. Yangi lobbi ochamiz
  return initGroupLobby(ctx, quizId);
});

// TESTNI O'CHIRISH
bot.action(/^delete_quiz_(.+)$/, async ctx => {
  const quizId = ctx.match[1];
  try {
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return ctx.answerCbQuery("Test topilmadi!", true);

    if (quiz.creatorId !== ctx.from.id) {
      return ctx.answerCbQuery(
        "Bu testni faqat uning muallifi o'chira oladi!",
        true
      );
    }

    await Quiz.findByIdAndDelete(quizId);
    await Result.deleteMany({ quizId: quizId });

    await ctx.deleteMessage();
    await ctx.reply(`✅ <b>"${quiz.title}"</b> testi o'chirildi!`, {
      parse_mode: "HTML",
    });
  } catch (e) {
    console.error(e);
    ctx.answerCbQuery("Xatolik bo'ldi.", true);
  }
});

// ===================================================
// 📊 STATISTIKA (TOP REYTING - YANGILANGAN)
// ===================================================

bot.action(/^stats_(.+)$/, async ctx => {
  const quizId = ctx.match[1];

  try {
    // 1. Test ma'lumotlarini olamiz (Nomi va vaqti uchun)
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return ctx.answerCbQuery("Test topilmadi.", true);

    // 2. Jami qatnashchilar sonini hisoblaymiz (Unique)
    const totalParticipants = await Result.distinct("userId", {
      quizId: new mongoose.Types.ObjectId(quizId),
    });
    const participantsCount = totalParticipants.length;

    // 3. TOP REYTINGNI TUZISH (Aggregation)
    const topResults = await Result.aggregate([
      // A) Shu testga tegishli natijalarni olamiz
      { $match: { quizId: new mongoose.Types.ObjectId(quizId) } },

      // B) Avval ball bo'yicha (kamayish), keyin vaqt bo'yicha saralaymiz
      { $sort: { score: -1, finishedAt: 1 } },

      // C) Har bir userning faqat BITTA (eng yaxshi) natijasini olib qolamiz
      {
        $group: {
          _id: "$userId", // User ID bo'yicha guruhlash
          userName: { $first: "$userName" }, // Ismini saqlash
          bestScore: { $first: "$score" }, // Eng yuqori ballni olish
          attempts: { $sum: 1 }, // Necha marta ishlaganini sanash (qiziq bo'lsa)
        },
      },

      // D) Endi toza ro'yxatni yana ball bo'yicha saralaymiz
      { $sort: { bestScore: -1 } },

      // E) Faqat Top 20 talikni olamiz
      { $limit: 20 },
    ]);

    // 4. Xabarni shakllantirish
    let msg = `🏆 <b>“${quiz.title}” testidagi eng yuqori natijalar</b>\n\n`;
    msg += `🖊 <b>${quiz.questions.length}</b> ta savol\n`;
    msg += `⏱ Har bir savolga <b>${quiz.settings.time_limit}</b> soniya\n`;
    msg += `🤓 <b>${participantsCount}</b> kishi testda qatnashdi\n\n`;

    if (topResults.length === 0) {
      msg += "<i>Hozircha natijalar yo'q. Birinchi bo'lib ishlang!</i>";
    } else {
      topResults.forEach((r, i) => {
        let rank = `${i + 1}.`;
        if (i === 0) rank = "🥇";
        if (i === 1) rank = "🥈";
        if (i === 2) rank = "🥉";

        // Ism (HTML teglaridan tozalab)
        const safeName = r.userName
          ? r.userName.replace(/</g, "&lt;")
          : "Noma'lum";

        msg += `${rank} <b>${safeName}</b> – ${r.bestScore}\n`;
      });
    }

    // 5. Xabarni chiqarish
    // Eski xabarni o'chirib yangisini yozamiz yoki edit qilamiz
    await ctx.editMessageText(msg, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "« Testga qaytish",
            `view_quiz_menu_${quizId}`
          ),
        ], // Orqaga qaytish tugmasi
      ]),
    });
  } catch (e) {
    console.error("Stats Error:", e);
    await ctx.answerCbQuery("Statistikani yuklashda xatolik.", true);
  }
});

// "Testga qaytish" tugmasi uchun handler (Agar yo'q bo'lsa qo'shib qo'ying)
bot.action(/^view_quiz_menu_(.+)$/, async ctx => {
  const quizId = ctx.match[1];
  const quiz = await Quiz.findById(quizId);
  if (!quiz) return ctx.deleteMessage();

  // Bu yerda o'sha "view_" dagi menyuni qayta chizamiz
  const botUser = ctx.botInfo.username;
  const privateLink = `https://t.me/${botUser}?start=${quiz._id}`;
  const groupLink = `https://t.me/${botUser}?startgroup=${quiz._id}`;

  let statsText = `<b>${quiz.title}</b>\n`;
  if (quiz.description) statsText += `<i>${quiz.description}</i>\n`;
  statsText += `\n🖊 ${quiz.questions.length} ta savol\n`;
  statsText += `⏱ ${quiz.settings.time_limit} soniya\n\n`;
  statsText += `🔗 <b>Ulashish havolasi:</b>\n${privateLink}`;

  await ctx.editMessageText(statsText, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "▶️ Yakkaxon boshlash",
          `start_solo_${quiz._id}`
        ),
      ],
      [Markup.button.url("👥 Guruhda boshlash", groupLink)],
      [Markup.button.callback("📝 Testni tahrirlash", `edit_main_${quiz._id}`)],
      [
        Markup.button.callback("📊 Statistika", `stats_${quiz._id}`),
        Markup.button.callback("🗑 O'chirish", `delete_quiz_${quiz._id}`),
      ],
    ]),
  });
});

// ===================================================
// 2. GURUH O'YINI (MULTIPLAYER LOBBY)
// ===================================================

// ===================================================
// GURUH O'YININI BOSHLASH (HIMOYA BILAN)
// ===================================================
async function initGroupLobby(ctx, quizId) {
  // 1. HIMOYA: Agar guruhda o'yin bor bo'lsa, yangisini ochtirmaymiz
  if (groupGames.has(ctx.chat.id)) {
    return ctx.reply(
      "🚫 <b>Guruhda allaqachon o'yin ketmoqda!</b>\n\n" +
        "Iltimos, avvalgi o'yin tugashini kuting yoki majburiy to'xtatish uchun <b>/stop</b> buyrug'ini yuboring.",
      { parse_mode: "HTML" }
    );
  }

  const quiz = await Quiz.findById(quizId);
  if (!quiz) return ctx.reply("Test topilmadi.");

  // --- Variantlarni aralashtirish (Boya qo'shgan kodimiz) ---
  let processedQuestions = quiz.questions.map(q => {
    let newQ = q.toObject ? q.toObject() : { ...q };

    if (quiz.settings.shuffle_options) {
      const correctText = newQ.options[newQ.correct_option_id];
      newQ.options = newQ.options.sort(() => Math.random() - 0.5);
      newQ.correct_option_id = newQ.options.indexOf(correctText);
    }
    return newQ;
  });

  if (quiz.settings.shuffle_questions) {
    processedQuestions = processedQuestions.sort(() => Math.random() - 0.5);
  }
  // -------------------------------------------------------

  groupGames.set(ctx.chat.id, {
    quizId: quiz._id,
    title: quiz.title,
    description: quiz.description,
    creatorId: quiz.creatorId,
    createdAt: quiz.createdAt,
    questions: processedQuestions,
    currentQIndex: 0,
    time_limit: quiz.settings.time_limit,
    players: new Set(),
    playerNames: new Map(),
    scores: new Map(),
    answeredUsers: new Set(),
    // --- MANA BU YANGI QO'SHILDI ---
    emptyCount: 0, // Nechta savolga javob berilmadi?
    // -------------------------------
    status: "lobby",
    timer: null,
  });

  await ctx.reply(
    `📢 <b>"${quiz.title}"</b> testi uchun ro'yxatdan o'tish boshlandi!\n\n` +
      `Qatnashish uchun <b>"➕ Qo'shilish"</b> tugmasini bosing.\n` +
      `Kamida <b>2 kishi</b> yig'ilganda Admin boshlashi mumkin.`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("➕ Qo'shilish", "join_game")],
        [Markup.button.callback("🚀 Boshlash (Admin)", "start_group_game")],
      ]),
    }
  );
}

bot.action("join_game", async ctx => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const game = groupGames.get(chatId);

  if (!game || game.status !== "lobby") {
    return ctx.answerCbQuery("O'yin allaqachon boshlangan yoki tugagan.", {
      show_alert: true,
    });
  }

  if (game.players.has(userId)) {
    return ctx.answerCbQuery("Siz allaqachon ro'yxatdasiz!", {
      show_alert: true,
    });
  }

  game.players.add(userId);
  game.scores.set(userId, 0);

  const displayName = ctx.from.username
    ? `@${ctx.from.username}`
    : ctx.from.first_name;
  game.playerNames.set(userId, displayName);

  const namesList = Array.from(game.playerNames.values())
    .map(name => `• ${name}`)
    .join("\n");

  await ctx.editMessageText(
    `📢 <b>"${game.title}"</b>\n\n` +
      `✅ <b>Ro'yxatdan o'tganlar (${game.players.size}):</b>\n` +
      `${namesList}\n\n` +
      `Boshlash uchun "Boshlash" ni bosing (min 2 kishi).`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("➕ Qo'shilish", "join_game")],
        [Markup.button.callback("🚀 Boshlash (Admin)", "start_group_game")],
      ]),
    }
  );
  ctx.answerCbQuery("Muvaffaqiyatli qo'shildingiz!");
});

// ===================================================
// GURUH O'YININI BOSHLASH (YANGILANGAN - INFO BILAN)
// ===================================================
bot.action("start_group_game", async ctx => {
  const game = groupGames.get(ctx.chat.id);
  if (!game) return ctx.answerCbQuery("O'yin topilmadi.");

  if (game.players.size < 2) {
    return ctx.answerCbQuery("⚠️ Kamida 2 kishi qo'shilishi kerak!", {
      show_alert: true,
    });
  }

  game.status = "playing";
  await ctx.deleteMessage().catch(() => {});

  // --- VAQTNI HISOBLASH ---
  const createdDate = new Date(game.createdAt);
  const now = new Date();
  const diffTime = Math.abs(now - createdDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // --- LINK YASASH ---
  const botUsername = ctx.botInfo.username;
  const privateLink = `https://t.me/${botUsername}?start=${game.quizId}`;

  // --- CHIROYLI XABAR ---
  const msg =
    `🚀 <b>O'yin boshlandi!</b>\n\n` +
    `📚 <b>Test nomi:</b> ${game.title}\n` +
    `👤 <b>Muallif ID:</b> <code>${game.creatorId}</code>\n` +
    `📅 <b>Yaratilgan sana:</b> ${diffDays} kun oldin\n\n` +
    `🔗 <a href="${privateLink}">Botda o'zingiz ishlash uchun havola</a>\n\n` +
    `<i>Barchaga omad! Savollar kelmoqda...</i>`;

  await ctx.reply(msg, {
    parse_mode: "HTML",
    disable_web_page_preview: true, // Linkdagi rasm chiqib ketmasligi uchun
  });

  sendGroupQuestion(ctx.chat.id, ctx.telegram);
});

async function sendGroupQuestion(chatId, telegram) {
  const game = groupGames.get(chatId);
  if (!game) return;

  if (game.currentQIndex >= game.questions.length) {
    return finishGroupGame(chatId, telegram);
  }

  const q = game.questions[game.currentQIndex];
  game.answeredUsers.clear();

  // --- 🔥 YANGI QO'SHILADIGAN HIMOYA KODI 🔥 ---
  // Agar savol matni yo'q bo'lsa yoki variantlardan biri bo'sh bo'lsa, o'tkazib yuboramiz
  if (!q.question || q.options.some(opt => !opt || opt.trim() === "")) {
    console.log(`⚠️ Buzuq savol o'tkazib yuborildi: "${q.question}"`);
    game.currentQIndex++; // Keyingi savolga o'tamiz
    return sendGroupQuestion(chatId, telegram); // Qayta chaqiramiz
  }

  if (typeof q.correct_option_id !== "number") {
    game.currentQIndex++;
    return sendGroupQuestion(chatId, telegram);
  }

  try {
    const questionNum = game.currentQIndex + 1;
    const questionText = `${questionNum}. ${q.question}`;

    // O'ZGARISH: Yuborilgan xabarni "msg" ga saqlaymiz
    const msg = await telegram.sendQuiz(chatId, questionText, q.options, {
      is_anonymous: false,
      correct_option_id: q.correct_option_id,
      explanation: q.explanation,
      open_period: game.time_limit,
    });

    // MUHIM: Shu savolning ID sini saqlab qo'yamiz
    game.currentPollId = msg.poll.id;

    if (game.timer) clearTimeout(game.timer);
    game.timer = setTimeout(
      () => {
        forceNextGroupQuestion(chatId, telegram);
      },
      (game.time_limit + 2) * 1000
    );
  } catch (e) {
    console.error(e);
    game.currentQIndex++;
    sendGroupQuestion(chatId, telegram);
  }
}

// ===================================================
// KEYINGI SAVOLGA O'TISH (AUTO-STOP HIMOYA BILAN)
// ===================================================
function forceNextGroupQuestion(chatId, telegram) {
  const game = groupGames.get(chatId);
  if (!game) return;

  // 1. TEKSHIRAMIZ: Hozirgina tugagan savolga kimdir javob berdimi?
  if (game.answeredUsers.size === 0) {
    // Hech kim javob bermadi -> Hisoblagichni oshiramiz
    game.emptyCount += 1;
  } else {
    // Kimdir javob berdi -> Hisoblagichni nollaymiz
    game.emptyCount = 0;
  }

  // 2. AGAR 2 TA SAVOL KETMA-KET JAVOBSIZ QOLSA
  if (game.emptyCount >= 2) {
    if (game.timer) clearTimeout(game.timer);

    // O'yinni o'chiramiz
    groupGames.delete(chatId);

    return telegram.sendMessage(
      chatId,
      "🛑 <b>Faollik yo'qligi sababli o'yin avtomatik to'xtatildi.</b>\n\nDavom etish uchun qaytadan boshlang.",
      { parse_mode: "HTML" }
    );
  }

  // 3. Agar hammasi joyida bo'lsa, keyingi savolga o'tamiz
  game.currentQIndex++;
  sendGroupQuestion(chatId, telegram);
}

// ===================================================
// GURUH O'YININI YAKUNLASH (YANGILANGAN)
// ===================================================
async function finishGroupGame(chatId, telegram) {
  const game = groupGames.get(chatId);
  if (!game) return;

  if (game.timer) clearTimeout(game.timer);

  // Ballar bo'yicha saralaymiz
  const sortedScores = [...game.scores.entries()].sort((a, b) => b[1] - a[1]);

  let msg = `🏁 <b>O'yin yakunlandi!</b>\n\n🏆 <b>G'oliblar ro'yxati:</b>\n\n`;

  // 3-O'ZGARISH: Sikl hamma uchun aylanadi (limit qo'ymaymiz)
  for (let i = 0; i < sortedScores.length; i++) {
    const [userId, score] = sortedScores[i];
    const name = game.playerNames.get(userId) || "Foydalanuvchi";

    // Medal yoki shunchaki raqam berish
    let prefix = "";
    if (i === 0) prefix = "🥇";
    else if (i === 1) prefix = "🥈";
    else if (i === 2) prefix = "🥉";
    else prefix = `${i + 1}.`; // 4., 5. va hokazo

    msg += `${prefix} <b>${name}</b>: ${score} ball\n`;

    // Bazaga yozish (faqat mavjud userlar uchun)
    try {
      await Result.create({
        userId: userId,
        userName: name,
        quizId: game.quizId,
        score: score,
        totalQuestions: game.questions.length,
      });

      await User.findOneAndUpdate(
        { telegramId: userId },
        {
          $inc: {
            totalScore: score,
            quizzesSolved: 1,
          },
        }
      );
    } catch (e) {
      // User bazada bo'lmasa (masalan, start bosmagan bo'lsa), shunchaki o'tkazib yuboramiz
    }
  }

  msg += `\nJami savollar: ${game.questions.length} ta`;

  try {
    await telegram.sendMessage(chatId, msg, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🔄 Qayta o'ynash",
              callback_data: `restart_group_${game.quizId}`,
            },
          ],
        ],
      },
    });
  } catch (e) {
    console.log("Xabar yuborishda xato:", e);
  }

  groupGames.delete(chatId);
}

// ===================================================
// 3. YAKKAXON O'YIN (SOLO MODE)
// ===================================================

async function initSoloQuizSession(ctx, quizId) {
  try {
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return ctx.reply("Test topilmadi.");

    // --- YANGI QO'SHILGAN QISM: Variantlarni aralashtirish ---
    let processedQuestions = quiz.questions.map(q => {
      let newQ = q.toObject ? q.toObject() : { ...q };

      if (quiz.settings.shuffle_options) {
        const correctText = newQ.options[newQ.correct_option_id];
        newQ.options = newQ.options.sort(() => Math.random() - 0.5);
        newQ.correct_option_id = newQ.options.indexOf(correctText);
      }
      return newQ;
    });

    if (quiz.settings.shuffle_questions) {
      processedQuestions = processedQuestions.sort(() => Math.random() - 0.5);
    }
    // -------------------------------------------------------

    const userId = ctx.from.id;
    if (activeGames.has(userId)) {
      clearTimeout(activeGames.get(userId).timer);
      activeGames.delete(userId);
    }

    activeGames.set(userId, {
      quizId: quiz._id,
      questions: processedQuestions, // <--- Aralashganini beramiz
      currentValues: 0,
      score: 0,
      time_limit: quiz.settings.time_limit,
      chatId: ctx.chat.id,
      userName: ctx.from.first_name,
      emptyCount: 0, // Javobsiz qolgan savollar soni
      timer: null,
    });

    await ctx.reply(`🚀 <b>"${quiz.title}"</b> testi boshlanmoqda!`, {
      parse_mode: "HTML",
    });
    await sendSoloQuestion(userId);
  } catch (err) {
    console.error("Init Error:", err);
  }
}

// ===================================================
// YAKKAXON O'YINNI BOSHLASH (TEKSHIRUV BILAN)
// ===================================================

bot.action(/^start_solo_(.+)$/, async ctx => {
  const newQuizId = ctx.match[1];
  const userId = ctx.from.id;

  // 1. Agar user allaqachon boshqa test ishlayotgan bo'lsa
  if (activeGames.has(userId)) {
    const currentGame = activeGames.get(userId);

    // Agar aynan shu testni o'zini qayta boshlamoqchi bo'lsa (Restart)
    if (currentGame.quizId.toString() === newQuizId) {
      // Davom ettirishga ruxsat beramiz yoki restart qilamiz (pastdagi mantiqqa o'tadi)
      // Lekin odatda restart_solo_ alohida ishlaydi.
    }

    return ctx.reply(
      `⚠️ <b>Sizda yakunlanmagan test bor!</b>\n\n` +
        `Eski testni to'xtatib, yangisini boshlashni xohlaysizmi?`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ Ha, yangisini boshlash",
              `force_start_solo_${newQuizId}`
            ),
          ],
          [Markup.button.callback("🚫 Yo'q, davom ettirish", "delete_msg")],
        ]),
      }
    );
  }

  // 2. Agar bo'sh bo'lsa, odatiy boshlash
  await ctx.answerCbQuery();
  return initSoloQuizSession(ctx, newQuizId);
});

// --- YANGI: Majburiy boshlash (Eskisini o'chirib) ---
bot.action(/^force_start_solo_(.+)$/, async ctx => {
  const newQuizId = ctx.match[1];
  const userId = ctx.from.id;

  // 1. Eski o'yinni to'xtatamiz
  if (activeGames.has(userId)) {
    const game = activeGames.get(userId);
    if (game.timer) clearTimeout(game.timer);
    activeGames.delete(userId);
  }

  // 2. Xabarni yangilaymiz
  await ctx.deleteMessage().catch(() => {});
  await ctx.answerCbQuery("Eski test to'xtatildi.");

  // 3. Yangisini boshlaymiz
  return initSoloQuizSession(ctx, newQuizId);
});

async function sendSoloQuestion(userId) {
  const game = activeGames.get(userId);
  if (!game) return;

  if (game.currentValues >= game.questions.length) {
    return finishSoloQuiz(userId);
  }

  const q = game.questions[game.currentValues];

  // --- 🔥 YANGI QO'SHILADIGAN HIMOYA KODI 🔥 ---
  if (!q.question || q.options.some(opt => !opt || opt.trim() === "")) {
    console.log(`⚠️ Buzuq savol o'tkazib yuborildi: "${q.question}"`);
    game.currentValues++;
    return sendSoloQuestion(userId);
  }

  if (typeof q.correct_option_id !== "number") {
    game.currentValues++;
    return sendSoloQuestion(userId);
  }

  try {
    const questionNum = game.currentValues + 1;
    const questionText = `${questionNum}. ${q.question}`;

    // O'ZGARISH: msg ga saqlaymiz
    const msg = await bot.telegram.sendQuiz(
      game.chatId,
      questionText,
      q.options,
      {
        is_anonymous: false,
        correct_option_id: q.correct_option_id,
        explanation: q.explanation,
        open_period: game.time_limit,
      }
    );

    // MUHIM: ID ni saqlaymiz
    game.currentPollId = msg.poll.id;

    if (game.timer) clearTimeout(game.timer);
    game.timer = setTimeout(
      () => {
        forceNextSoloQuestion(userId);
      },
      (game.time_limit + 3) * 1000
    );

    activeGames.set(userId, game);
  } catch (error) {
    game.currentValues++;
    return sendSoloQuestion(userId);
  }
}

// ===================================================
// YAKKAXON KEYINGI SAVOL (AUTO-STOP BILAN)
// ===================================================
function forceNextSoloQuestion(userId) {
  const game = activeGames.get(userId);
  if (!game) return;

  // 1. Javob bermagani uchun hisoblagichni oshiramiz
  game.emptyCount = (game.emptyCount || 0) + 1;

  // 2. Agar 2 marta ketma-ket javob bermagan bo'lsa
  if (game.emptyCount >= 2) {
    activeGames.delete(userId); // O'yinni o'chiramiz

    return bot.telegram.sendMessage(
      game.chatId,
      "🛑 <b>Faollik yo'qligi sababli test to'xtatildi.</b>\n\nDavom ettirish uchun qaytadan boshlang.",
      { parse_mode: "HTML" }
    );
  }

  // 3. Davom etamiz
  game.currentValues++;
  activeGames.set(userId, game);
  sendSoloQuestion(userId);
}

async function finishSoloQuiz(userId) {
  const game = activeGames.get(userId);
  if (!game) return;
  if (game.timer) clearTimeout(game.timer);

  try {
    // 1. Natijani tarixga yozamiz
    await Result.create({
      userId: userId,
      userName: game.userName,
      quizId: game.quizId,
      score: game.score,
      totalQuestions: game.questions.length,
    });

    // 2. Test o'ynalganlar sonini oshiramiz
    await Quiz.findByIdAndUpdate(game.quizId, { $inc: { plays: 1 } });

    // 3. Userni ballini oshiramiz
    await User.findOneAndUpdate(
      { telegramId: userId },
      {
        $inc: {
          totalScore: game.score,
          quizzesSolved: 1,
        },
      }
    );

    // --- O'ZGARISH SHU YERDA (TUGMA QO'SHILDI) ---
    await bot.telegram.sendMessage(
      game.chatId,
      `🏁 <b>Test yakunlandi!</b>\n👤 ${game.userName}\n✅ Natija: ${game.score} / ${game.questions.length}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "🔄 Takror ishlash",
              `restart_solo_${game.quizId}`
            ),
          ], // <--- TUGMA
          [Markup.button.callback("❌ Yopish", "delete_msg")],
        ]),
      }
    );
    // ---------------------------------------------
  } catch (err) {
    console.error(err);
  }
  activeGames.delete(userId);
}

// ===================================================
// 4. JAVOBLARNI QABUL QILISH (TUZATILDI: SOLO FIRST)
// ===================================================

bot.on("poll_answer", async ctx => {
  const userId = ctx.pollAnswer.user.id;
  const userObj = ctx.pollAnswer.user;
  const answer = ctx.pollAnswer;
  const pollId = ctx.pollAnswer.poll_id; // <--- JAVOB QAYSI SAVOLGA KELDI?

  const displayName = userObj.username
    ? `@${userObj.username}`
    : userObj.first_name;

  // ----------------------------------------------------
  // 1. YAKKAXON (SOLO) O'YINNI TEKSHIRAMIZ
  // ----------------------------------------------------
  const soloGame = activeGames.get(userId);

  // Faqat o'yin bor bo'lsa VA poll_id mos kelsa qabul qilamiz
  if (soloGame && soloGame.currentPollId === pollId) {
    if (soloGame.timer) clearTimeout(soloGame.timer);
    soloGame.emptyCount = 0;

    const currentQ = soloGame.questions[soloGame.currentValues];
    if (currentQ && answer.option_ids[0] === currentQ.correct_option_id) {
      soloGame.score++;
    }

    soloGame.currentValues++;
    activeGames.set(userId, soloGame);

    setTimeout(() => {
      sendSoloQuestion(userId);
    }, 500);

    return; // <--- Solo o'yin edi, tamom.
  }

  // ----------------------------------------------------
  // 2. GURUH O'YININI TEKSHIRAMIZ
  // ----------------------------------------------------

  // Biz endi hamma guruhlarni aylanib, ID si to'g'ri kelganini topamiz
  let groupGame = null;
  let groupChatId = null;

  for (const [chatId, game] of groupGames.entries()) {
    // Faqat POLL ID si mos kelgan o'yinni qidiramiz
    if (game.status === "playing" && game.currentPollId === pollId) {
      groupGame = game;
      groupChatId = chatId;
      break; // Topdik!
    }
  }

  if (groupGame) {
    // Userni ro'yxatga qo'shamiz (Agar avval kirmagan bo'lsa)
    if (!groupGame.players.has(userId)) {
      groupGame.players.add(userId);
      groupGame.scores.set(userId, 0);
      groupGame.playerNames.set(userId, displayName);
    }

    if (groupGame.answeredUsers.has(userId)) return;
    groupGame.answeredUsers.add(userId);

    const currentQ = groupGame.questions[groupGame.currentQIndex];

    if (currentQ && answer.option_ids[0] === currentQ.correct_option_id) {
      const oldScore = groupGame.scores.get(userId) || 0;
      groupGame.scores.set(userId, oldScore + 1);
    }

    if (groupGame.answeredUsers.size === groupGame.players.size) {
      if (groupGame.timer) clearTimeout(groupGame.timer);
      setTimeout(() => {
        forceNextGroupQuestion(groupChatId, ctx.telegram);
      }, 1000);
    }
  }
});

bot.catch(err => console.log("Global error:", err));

bot
  .launch()
  .then(() => console.log("🚀 Quiz Bot (Full Multiplayer) ishga tushdi!"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// ===================================================
// ⚙️ TAHRIRLASH (EDIT MENU HANDLERS)
// ===================================================

// 1. ASOSIY TAHRIRLASH MENYUSI
bot.action(/^edit_main_(.+)$/, async ctx => {
  const quizId = ctx.match[1];
  const quiz = await Quiz.findById(quizId);
  if (!quiz) return ctx.answerCbQuery("Test topilmadi", true);

  // Muallif ekanligini tekshirish
  if (quiz.creatorId !== ctx.from.id) {
    return ctx.answerCbQuery("Faqat muallif tahrirlay oladi!", true);
  }

  const msg = `⚙️ <b>TAHRIRLASH BO'LIMI</b>\n\nTest: <b>${quiz.title}</b>\nNimani o'zgartiramiz?`;

  await ctx.editMessageText(msg, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "📝 Savollarni tahrirlash",
          `edit_qs_menu_${quizId}`
        ),
      ],
      [
        Markup.button.callback(
          "✏️ Sarlavhani tahrirlash",
          `edit_title_${quizId}`
        ),
      ],
      [Markup.button.callback("📝 Tavsifni tahrirlash", `edit_desc_${quizId}`)],
      [Markup.button.callback("⏱ Taymer sozlamalari", `edit_timer_${quizId}`)],
      [
        Markup.button.callback(
          "🔀 Aralashtirish sozlamalari",
          `edit_shuffle_${quizId}`
        ),
      ],
      [Markup.button.callback("« Orqaga", `view_quiz_menu_${quizId}`)],
    ]),
  });
});

// 2. SAVOLLARNI TAHRIRLASH MENYUSI
bot.action(/^edit_qs_menu_(.+)$/, async ctx => {
  const quizId = ctx.match[1];
  const quiz = await Quiz.findById(quizId);

  await ctx.editMessageText(
    `📝 <b>Savollar tahriri</b>\nJami savollar: ${quiz.questions.length} ta`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "➕ Yangi savol qo'shish",
            `add_question_${quizId}`
          ),
        ],
        [
          Markup.button.callback(
            "🗑 Oxirgi savolni o'chirish",
            `del_last_question_${quizId}`
          ),
        ],
        [Markup.button.callback("« Ortga qaytish", `edit_main_${quizId}`)],
      ]),
    }
  );
});

// 3. OXIRGI SAVOLNI O'CHIRISH
bot.action(/^del_last_question_(.+)$/, async ctx => {
  const quizId = ctx.match[1];
  const quiz = await Quiz.findById(quizId);

  if (quiz.questions.length === 0) {
    return ctx.answerCbQuery("Savollar qolmadi!", true);
  }

  // Arraydan oxirgisini olib tashlaymiz
  await Quiz.findByIdAndUpdate(quizId, { $pop: { questions: 1 } });

  await ctx.answerCbQuery("Oxirgi savol o'chirildi ✅");
  // Menyuni yangilash
  return ctx.editMessageText(
    `📝 <b>Savollar tahriri</b>\nJami savollar: ${quiz.questions.length - 1} ta`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "➕ Yangi savol qo'shish",
            `add_question_${quizId}`
          ),
        ],
        [
          Markup.button.callback(
            "🗑 Oxirgi savolni o'chirish",
            `del_last_question_${quizId}`
          ),
        ],
        [Markup.button.callback("« Ortga qaytish", `edit_main_${quizId}`)],
      ]),
    }
  );
});

// 4. SAHNALARGA KIRISH (ENTRY POINTS)
// Har bir tugma bosilganda sessiyaga ID ni saqlab, tegishli sahnaga kiramiz

bot.action(/^edit_title_(.+)$/, ctx => {
  ctx.session.editQuizId = ctx.match[1];
  ctx.scene.enter("edit_quiz_title");
});

bot.action(/^edit_desc_(.+)$/, ctx => {
  ctx.session.editQuizId = ctx.match[1];
  ctx.scene.enter("edit_quiz_desc");
});

bot.action(/^edit_timer_(.+)$/, ctx => {
  ctx.session.editQuizId = ctx.match[1];
  ctx.scene.enter("edit_quiz_timer");
});

bot.action(/^edit_shuffle_(.+)$/, ctx => {
  ctx.session.editQuizId = ctx.match[1];
  ctx.scene.enter("edit_quiz_shuffle");
});

bot.action(/^add_question_(.+)$/, ctx => {
  ctx.session.editQuizId = ctx.match[1];
  ctx.scene.enter("add_quiz_question");
});

// ===================================================
// O'YINNI TO'XTATISH UCHUN OVOZ BERISH
// ===================================================
bot.action("vote_stop_game", async ctx => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const game = groupGames.get(chatId);

  // Agar o'yin tugab qolgan bo'lsa
  if (!game || !game.stopVoteActive) {
    return ctx.answerCbQuery("Ovoz berish yakunlangan yoki o'yin yo'q.");
  }

  // Faqat o'yindagi ishtirokchilar ovoz bera olsinmi?
  // (Sizning talabingiz bo'yicha: "Test ishlaydigan userlar")
  if (!game.players.has(userId)) {
    return ctx.answerCbQuery(
      "🚫 Siz o'yinda ishtirok etmayapsiz! Ovoz bera olmaysiz.",
      { show_alert: true }
    );
  }

  // Bir kishi bir marta ovoz beradi
  if (game.stopVotes.has(userId)) {
    return ctx.answerCbQuery("Siz allaqachon ovoz berdingiz!");
  }

  // Ovozni qabul qilamiz
  game.stopVotes.add(userId);
  const currentVotes = game.stopVotes.size;

  // AGAR OVOZLAR YETARLI BO'LSA -> TO'XTATAMIZ
  if (currentVotes >= game.votesNeeded) {
    if (game.timer) clearTimeout(game.timer);
    groupGames.delete(chatId);

    await ctx.deleteMessage().catch(() => {});
    return ctx.reply(
      `🛑 <b>Ko'pchilik qarori bilan test to'xtatildi!</b>\n(${currentVotes} ta ovoz yig'ildi)`,
      { parse_mode: "HTML" }
    );
  }

  // AGAR HALI YETMASA -> XABARNI YANGILAYMIZ
  try {
    await ctx.editMessageText(
      `🛑 <b>O'yinni to'xtatish taklif qilindi!</b>\n\n` +
        `Agar <b>${game.votesNeeded}</b> kishi rozi bo'lsa, o'yin to'xtatiladi.\n` +
        `Hozirgi ovozlar: <b>${currentVotes} / ${game.votesNeeded}</b>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              `✋ Ha, to'xtatilsin (${currentVotes}/${game.votesNeeded})`,
              "vote_stop_game"
            ),
          ],
        ]),
      }
    );
    await ctx.answerCbQuery(
      `Ovoz qabul qilindi! (${currentVotes}/${game.votesNeeded})`
    );
  } catch (e) {
    // Xabar o'zgarmasa xato bermasligi uchun
  }
});

// ===================================================
// GURUHDA TESTNI SRAZI OCHISH (LICHKA UCHUN HAM MOSLANDI)
// ===================================================
bot.hears(/^\/start_lobby_(.+)$/, async ctx => {
  const quizId = ctx.match[1];

  // 1. AGAR LICHKADA BO'LSA -> TESTNI KO'RISH MENYUSINI CHIQARAMIZ
  // (Do'stingiz sizga shu kodni yuborsa, ustiga bossangiz shu yerga tushasiz)
  if (ctx.chat.type === "private") {
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return ctx.reply("❌ Test topilmadi.");

    const botUser = ctx.botInfo.username;
    const privateLink = `https://t.me/${botUser}?start=${quiz._id}`;
    const groupLink = `https://t.me/${botUser}?startgroup=${quiz._id}`;

    let statsText = `<b>${quiz.title}</b>\n`;
    if (quiz.description) statsText += `<i>${quiz.description}</i>\n`;
    statsText += `\n🖊 ${quiz.questions.length} ta savol\n`;
    statsText += `⏱ ${quiz.settings.time_limit} soniya\n\n`;
    statsText += `🔗 <b>Ulashish havolasi:</b>\n${privateLink}`;

    return ctx.reply(statsText, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "▶️ Yakkaxon boshlash",
            `start_solo_${quiz._id}`
          ),
        ],
        [Markup.button.url("👥 Guruhda boshlash", groupLink)],
        [
          Markup.button.callback(
            "📝 Testni tahrirlash",
            `edit_main_${quiz._id}`
          ),
        ],
        [Markup.button.callback("📊 Statistika", `stats_${quiz._id}`)],
      ]),
    });
  }

  // 2. AGAR GURUHDA BO'LSA -> SRAZI LOBBI OCHAMIZ
  await ctx.deleteMessage().catch(() => {});
  return initGroupLobby(ctx, quizId);
});
