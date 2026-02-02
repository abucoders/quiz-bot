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

// Sahnalarni ro'yxatga olish
const stage = new Scenes.Stage([createQuizScene, importQuizScene, adminScene]); // <--- QO'SHILDI

bot.use(session());
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
// 🔍 INLINE MODE (QIDIRUV TIZIMI)
// ===================================================

bot.on("inline_query", async ctx => {
  const query = ctx.inlineQuery.query; // Foydalanuvchi yozgan matn
  let quizzes = [];

  try {
    if (query) {
      // 1. Agar biror narsa yozsa, nomi bo'yicha qidiramiz (Regex - harf katta kichikligiga qaramaydi)
      quizzes = await Quiz.find({
        title: { $regex: query, $options: "i" },
      }).limit(20);
    } else {
      // 2. Agar hech narsa yozmasa, eng yangi 20 ta testni chiqaramiz
      quizzes = await Quiz.find().sort({ createdAt: -1 }).limit(20);
    }

    // Natijalarni Telegram tushunadigan formatga o'tkazamiz
    const results = quizzes.map(q => ({
      type: "article",
      id: q._id.toString(),
      title: q.title,
      description: `${q.questions.length} ta savol | ⏱ ${q.settings.time_limit} soniya`,
      thumb_url: "https://cdn-icons-png.flaticon.com/512/3407/3407024.png", // Test ikonkasining rasmi
      input_message_content: {
        message_text:
          `📢 <b>${q.title}</b>\n\n` +
          `🖊 Savollar soni: ${q.questions.length} ta\n` +
          `⏱ Vaqt: ${q.settings.time_limit} soniya\n\n` +
          `👇 Testni ishlash uchun tugmani bosing:`,
        parse_mode: "HTML",
      },
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🚀 Testni boshlash",
              url: `https://t.me/${ctx.botInfo.username}?start=${q._id}`,
            },
            {
              text: "👥 Guruhda boshlash",
              url: `https://t.me/${ctx.botInfo.username}?startgroup=${q._id}`,
            },
          ],
        ],
      },
    }));

    // Natijani foydalanuvchiga ko'rsatamiz
    // cache_time: 0 qildik, shunda yangi test qo'shilsa darhol ko'rinadi
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
    const payload = ctx.startPayload; // start dan keyingi yozuv (masalan: ref_12345)
    let user = await User.findOne({ telegramId: ctx.from.id });

    // 1. Agar foydalanuvchi YANGI bo'lsa (Bazada yo'q bo'lsa)
    if (!user) {
      // Referal ekanligini tekshiramiz
      const isReferral = payload && payload.startsWith("ref_");

      // Yangi user yaratamiz
      user = await User.create({
        telegramId: ctx.from.id,
        firstName: ctx.from.first_name,
        username: ctx.from.username,
        // AGAR REFERAL BO'LSA 50 COIN, BO'LMASA 0
        coins: isReferral ? 80 : 50,
      });

      // 2. REFERAL MUKOFOTLARI
      if (isReferral) {
        const referrerId = Number(payload.replace("ref_", "")); // "ref_12345" -> 12345

        // O'zini o'zi taklif qilolmasin
        if (referrerId !== ctx.from.id) {
          // A) TAKLIF QILGAN ODAMGA (100 Coin)
          const referrer = await User.findOneAndUpdate(
            { telegramId: referrerId },
            { $inc: { coins: 110 } }
          );

          if (referrer) {
            await bot.telegram.sendMessage(
              referrerId,
              `🎉 <b>Tabriklaymiz!</b>\nSizning havolangiz orqali <b>${ctx.from.first_name}</b> botga qo'shildi.\n💰 <b>Sizga 100 Coin berildi!</b>`,
              { parse_mode: "HTML" }
            );
          }

          // B) YANGI KIRGAN ODAMGA (Xabar beramiz, coin allaqachon yozildi)
          await ctx.reply(
            `🎁 <b>Xush kelibsiz!</b>\nDo'stingiz taklifi bilan kirganingiz uchun sizga <b>100 Coin bonus</b> berildi! 💰`,
            { parse_mode: "HTML" }
          );
        }
      }
    } else {
      // Agar user oldin bor bo'lsa, shunchaki ma'lumotini yangilab qo'yamiz
      await User.findOneAndUpdate(
        { telegramId: ctx.from.id },
        {
          firstName: ctx.from.first_name,
          username: ctx.from.username,
          lastActive: Date.now(),
        }
      );
    }

    // --- START DAVOMI (O'yinlarni ushlash) ---

    // A) Guruh va Lichka o'yinlari
    if (payload && !payload.startsWith("ref_")) {
      if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
        return initGroupLobby(ctx, payload);
      }
      if (ctx.chat.type === "private") {
        return initSoloQuizSession(ctx, payload);
      }
    }

    // B) Oddiy Menyu (Faqat lichkada)
    if (ctx.chat.type === "private") {
      await ctx.reply(
        `👋 <b>Asosiy Menyu</b>\n\n` + `Quyidagi bo'limlardan birini tanlang:`,
        {
          parse_mode: "HTML",
          ...Markup.keyboard([
            ["Yangi test tuzish", "📥 Matn orqali yuklash"],
            ["Testlarimni ko'rish", "👤 Mening profilim"],
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
bot.hears("📥 Matn orqali yuklash", ctx => ctx.scene.enter("import_quiz")); //

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

bot.hears("Testlarimni ko'rish", async ctx => {
  try {
    const quizzes = await Quiz.find({ creatorId: ctx.from.id });
    if (quizzes.length === 0) return ctx.reply("Sizda testlar yo'q.");

    let msg = "<b>Sizning testlaringiz:</b>\n\n";
    quizzes.forEach((q, i) => {
      msg += `${i + 1}. <b>${q.title}</b> - /view_${q._id}\n`;
    });
    ctx.reply(msg, { parse_mode: "HTML" });
  } catch (e) {
    console.error(e);
  }
});

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
      [
        Markup.button.callback("📊 Statistika", `stats_${quiz._id}`),
        Markup.button.callback("🗑 O'chirish", `delete_quiz_${quiz._id}`),
      ],
    ]),
  });
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

// STATISTIKA
bot.action(/^stats_(.+)$/, async ctx => {
  const quizId = ctx.match[1];
  const results = await Result.find({ quizId: quizId })
    .sort({ score: -1 })
    .limit(10);

  let msg = `📊 <b>Top 10 Natijalar:</b>\n\n`;
  if (results.length === 0) msg += "Natijalar yo'q.";
  else
    results.forEach(
      (r, i) => (msg += `${i + 1}. ${r.userName} — ${r.score} ball\n`)
    );

  await ctx.reply(msg, { parse_mode: "HTML" });
  await ctx.answerCbQuery();
});

// ===================================================
// 2. GURUH O'YINI (MULTIPLAYER LOBBY)
// ===================================================

// ===================================================
// GURUH O'YININI BOSHLASH (VARIANTLARNI ARALASHTIRISH BILAN)
// ===================================================
async function initGroupLobby(ctx, quizId) {
  const quiz = await Quiz.findById(quizId);
  if (!quiz) return ctx.reply("Test topilmadi.");

  // --- YANGI QO'SHILGAN QISM: Variantlarni aralashtirish ---
  // Biz savollarni "klon" qilib olamiz, aks holda bazadagi asli o'zgarib ketishi mumkin
  let processedQuestions = quiz.questions.map(q => {
    let newQ = q.toObject ? q.toObject() : { ...q }; // Obyekt nusxasini olish

    // Agar variantlarni aralashtirish yoqilgan bo'lsa
    if (quiz.settings.shuffle_options) {
      const correctText = newQ.options[newQ.correct_option_id]; // To'g'ri javob matni

      // Variantlarni aralashtiramiz
      newQ.options = newQ.options.sort(() => Math.random() - 0.5);

      // To'g'ri javobning yangi indeksini topamiz
      newQ.correct_option_id = newQ.options.indexOf(correctText);
    }
    return newQ;
  });

  // Savollar tartibini aralashtirish (agar kerak bo'lsa)
  if (quiz.settings.shuffle_questions) {
    processedQuestions = processedQuestions.sort(() => Math.random() - 0.5);
  }
  // -------------------------------------------------------

  groupGames.set(ctx.chat.id, {
    quizId: quiz._id,
    title: quiz.title,
    questions: processedQuestions, // <--- Aralashgan savollar ketdi
    currentQIndex: 0,
    time_limit: quiz.settings.time_limit,
    players: new Set(),
    playerNames: new Map(),
    scores: new Map(),
    answeredUsers: new Set(),
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
  game.playerNames.set(userId, ctx.from.first_name);

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
  await ctx.reply(`🚀 <b>O'yin boshlandi!</b>\nBarchaga omad!`, {
    parse_mode: "HTML",
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

  if (typeof q.correct_option_id !== "number") {
    game.currentQIndex++;
    return sendGroupQuestion(chatId, telegram);
  }

  try {
    await telegram.sendQuiz(chatId, q.question, q.options, {
      is_anonymous: false,
      correct_option_id: q.correct_option_id,
      explanation: q.explanation,
      open_period: game.time_limit,
    });

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

function forceNextGroupQuestion(chatId, telegram) {
  const game = groupGames.get(chatId);
  if (!game) return;
  game.currentQIndex++;
  sendGroupQuestion(chatId, telegram);
}

async function finishGroupGame(chatId, telegram) {
  const game = groupGames.get(chatId);
  if (!game) return;

  if (game.timer) clearTimeout(game.timer);

  const sortedScores = [...game.scores.entries()].sort((a, b) => b[1] - a[1]);
  let msg = `🏁 <b>O'yin yakunlandi!</b>\n\n🏆 <b>G'oliblar ro'yxati:</b>\n\n`;

  for (let i = 0; i < sortedScores.length; i++) {
    const [userId, score] = sortedScores[i];
    const name = game.playerNames.get(userId) || "Foydalanuvchi";
    let medal = "👤";
    if (i === 0) medal = "🥇";
    if (i === 1) medal = "🥈";
    if (i === 2) medal = "🥉";

    msg += `${medal} <b>${name}</b>: ${score} ball\n`;

    try {
      // 1. Tarixga yozish
      await Result.create({
        userId: userId,
        userName: name,
        quizId: game.quizId,
        score: score,
        totalQuestions: game.questions.length,
      });

      // --- YANGI: USER BALLINI OSHIRISH ---
      await User.findOneAndUpdate(
        { telegramId: userId },
        {
          $inc: {
            totalScore: score,
            quizzesSolved: 1,
          },
        }
      );
      // ------------------------------------
    } catch (e) {}
  }

  msg += `\nJami savollar: ${game.questions.length} ta`;
  await telegram.sendMessage(chatId, msg, { parse_mode: "HTML" });
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

bot.action(/^start_solo_(.+)$/, ctx => {
  ctx.answerCbQuery();
  initSoloQuizSession(ctx, ctx.match[1]);
});

async function sendSoloQuestion(userId) {
  const game = activeGames.get(userId);
  if (!game) return;

  if (game.currentValues >= game.questions.length) {
    return finishSoloQuiz(userId);
  }

  const q = game.questions[game.currentValues];

  if (typeof q.correct_option_id !== "number") {
    game.currentValues++;
    return sendSoloQuestion(userId);
  }

  try {
    await bot.telegram.sendQuiz(game.chatId, q.question, q.options, {
      is_anonymous: false,
      correct_option_id: q.correct_option_id,
      explanation: q.explanation,
      open_period: game.time_limit,
    });

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

function forceNextSoloQuestion(userId) {
  const game = activeGames.get(userId);
  if (!game) return;
  game.currentValues++;
  activeGames.set(userId, game);
  sendSoloQuestion(userId);
}

async function finishSoloQuiz(userId) {
  const game = activeGames.get(userId);
  if (!game) return;
  if (game.timer) clearTimeout(game.timer);

  try {
    // 1. Natijani tarixga yozamiz (Result)
    await Result.create({
      userId: userId,
      userName: game.userName,
      quizId: game.quizId,
      score: game.score,
      totalQuestions: game.questions.length,
    });

    // 2. Test o'ynalganlar sonini oshiramiz
    await Quiz.findByIdAndUpdate(game.quizId, { $inc: { plays: 1 } });

    // --- YANGI: USERNI BALLINI OSHIRAMIZ ($inc - increment) ---
    // totalScore ga ballni qo'shamiz, quizzesSolved ga 1 ni qo'shamiz
    await User.findOneAndUpdate(
      { telegramId: userId },
      {
        $inc: {
          totalScore: game.score,
          quizzesSolved: 1,
        },
      }
    );
    // ---------------------------------------------------------

    await bot.telegram.sendMessage(
      game.chatId,
      `🏁 <b>Test yakunlandi!</b>\n👤 ${game.userName}\n✅ Natija: ${game.score} / ${game.questions.length}`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error(err);
  }
  activeGames.delete(userId);
}

// ===================================================
// 4. JAVOBLARNI QABUL QILISH (MARKAZIY LOGIKA)
// ===================================================

bot.on("poll_answer", async ctx => {
  const userId = ctx.pollAnswer.user.id;
  const answer = ctx.pollAnswer;

  let groupGame = null;
  let groupChatId = null;

  for (const [chatId, game] of groupGames.entries()) {
    if (game.status === "playing" && game.players.has(userId)) {
      groupGame = game;
      groupChatId = chatId;
      break;
    }
  }

  if (groupGame) {
    const currentQ = groupGame.questions[groupGame.currentQIndex];
    if (groupGame.answeredUsers.has(userId)) return;
    groupGame.answeredUsers.add(userId);

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
    return;
  }

  const soloGame = activeGames.get(userId);
  if (soloGame) {
    if (soloGame.timer) clearTimeout(soloGame.timer);
    const currentQ = soloGame.questions[soloGame.currentValues];
    if (currentQ && answer.option_ids[0] === currentQ.correct_option_id) {
      soloGame.score++;
    }
    soloGame.currentValues++;
    activeGames.set(userId, soloGame);
    setTimeout(() => {
      sendSoloQuestion(userId);
    }, 500);
  }
});

bot.catch(err => console.log("Global error:", err));

bot
  .launch()
  .then(() => console.log("🚀 Quiz Bot (Full Multiplayer) ishga tushdi!"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
