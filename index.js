require("dotenv").config();
const { Telegraf, Scenes, session, Markup } = require("telegraf");
const mongoose = require("mongoose");
const Quiz = require("./models/Quiz");
const Result = require("./models/Result");
const User = require("./models/User");
const createQuizScene = require("./scenes/createQuizScene");
const importQuizScene = require("./scenes/importQuizScene");

// MongoDB ulanishi
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error(err));

const bot = new Telegraf(process.env.BOT_TOKEN);
const stage = new Scenes.Stage([createQuizScene, importQuizScene]);

bot.use(session());
bot.use(stage.middleware());

// --- XOTIRA (RAM) ---
const activeGames = new Map();
const groupGames = new Map();

// ===================================================
// 1. START VA MENYU
// ===================================================

bot.start(async ctx => {
  // Userni bazaga saqlash
  try {
    await User.findOneAndUpdate(
      { telegramId: ctx.from.id },
      {
        firstName: ctx.from.first_name,
        username: ctx.from.username,
        lastActive: Date.now(),
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error("User save error:", err);
  }

  const payload = ctx.startPayload;

  // A) GURUHDA START (Deep Link orqali) -> LOBBY OCHISH
  if (
    payload &&
    (ctx.chat.type === "group" || ctx.chat.type === "supergroup")
  ) {
    return initGroupLobby(ctx, payload);
  }

  // B) LICHKADA START (Deep Link orqali) -> YAKKAXON O'YIN
  if (payload && ctx.chat.type === "private") {
    return initSoloQuizSession(ctx, payload);
  }

  // C) ODDIY MENYU (Login va Chat turini tekshirish)
  if (ctx.chat.type === "private") {
    // FAQAT LICHKADA MENYU CHIQADI
    await ctx.reply(
      `👋 <b>Xush kelibsiz, ${ctx.from.first_name}!</b>\n\nBu bot orqali testlar tuzishingiz va guruhlarda do'stlar bilan bellashingiz mumkin.`,
      {
        parse_mode: "HTML",
        ...Markup.keyboard([
          ["Yangi test tuzish", "📥 Matn orqali yuklash"],
          ["Testlarimni ko'rish", "👤 Mening profilim"],
        ]).resize(),
      }
    );
  } else {
    // GURUHDA SHUNCHAKI SALOM (Tugmalarsiz)
    await ctx.reply(
      `👋 Salom! Test ishlash uchun menga lichkada yozing yoki guruhga test havolasini tashlang.`
    );
  }
});

// --- MENYU HANDLERS ---
bot.hears("Yangi test tuzish", ctx => ctx.scene.enter("create_quiz"));

// Yangi funksiya uchun handler
bot.hears("📥 Matn orqali yuklash", ctx => ctx.scene.enter("import_quiz"));

// 1. MENING PROFILIM (YANGI FUNKSIYA)
bot.hears("👤 Mening profilim", async ctx => {
  const userId = ctx.from.id;

  // Foydalanuvchi ma'lumotlari
  const user = await User.findOne({ telegramId: userId });

  // Natijalarni hisoblash (Aggregation)
  const agg = await Result.aggregate([
    { $match: { userId: userId } },
    {
      $group: { _id: null, totalScore: { $sum: "$score" }, count: { $sum: 1 } },
    },
  ]);

  const stats = agg[0] || { totalScore: 0, count: 0 };

  // Unvon berish tizimi
  let rank = "Boshlovchi 👶";
  if (stats.totalScore > 50) rank = "Bilimdon 🧠";
  if (stats.totalScore > 200) rank = "Ekspert 🎓";
  if (stats.totalScore > 500) rank = "Professor 👨‍🏫";
  if (stats.totalScore > 1000) rank = "Afsona 🏆";

  await ctx.reply(
    `👤 <b>SIZNING PROFILINGIZ</b>\n\n` +
      `📝 Ism: <b>${user ? user.firstName : ctx.from.first_name}</b>\n` +
      `🆔 ID: <code>${userId}</code>\n\n` +
      `📊 <b>Sizning natijalaringiz:</b>\n` +
      `✅ Yechilgan testlar: <b>${stats.count}</b> ta\n` +
      `⭐️ Umumiy ball: <b>${stats.totalScore}</b>\n\n` +
      `🏅 Unvon: <b>${rank}</b>`,
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

// --- TESTNI KO'RISH VA ULASHISH (Yangilandi: O'chirish tugmasi) ---
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
        Markup.button.callback("🗑 O'chirish", `delete_quiz_${quiz._id}`), // <--- YANGI TUGMA
      ],
    ]),
  });
});

// 2. TESTNI O'CHIRISH (ACTION)
bot.action(/^delete_quiz_(.+)$/, async ctx => {
  const quizId = ctx.match[1];
  try {
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return ctx.answerCbQuery("Test topilmadi!", true);

    // Faqat test egasi o'chira oladi
    if (quiz.creatorId !== ctx.from.id) {
      return ctx.answerCbQuery(
        "Bu testni faqat uning muallifi o'chira oladi!",
        true
      );
    }

    // Testni o'chiramiz
    await Quiz.findByIdAndDelete(quizId);
    // Natijalarni ham o'chirish (ixtiyoriy)
    await Result.deleteMany({ quizId: quizId });

    await ctx.deleteMessage(); // Eski xabarni o'chirish
    await ctx.reply(
      `✅ <b>"${quiz.title}"</b> testi muvaffaqiyatli o'chirildi!`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    console.error(e);
    ctx.answerCbQuery("Xatolik bo'ldi.", true);
  }
});

// --- STATISTIKA ---
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

async function initGroupLobby(ctx, quizId) {
  const quiz = await Quiz.findById(quizId);
  if (!quiz) return ctx.reply("Test topilmadi.");

  groupGames.set(ctx.chat.id, {
    quizId: quiz._id,
    title: quiz.title,
    questions: quiz.questions,
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
      await Result.create({
        userId: userId,
        userName: name,
        quizId: game.quizId,
        score: score,
        totalQuestions: game.questions.length,
      });
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

    let questions = [...quiz.questions];
    if (quiz.settings.shuffle_questions) {
      questions = questions.sort(() => Math.random() - 0.5);
    }

    const userId = ctx.from.id;
    if (activeGames.has(userId)) {
      clearTimeout(activeGames.get(userId).timer);
      activeGames.delete(userId);
    }

    activeGames.set(userId, {
      quizId: quiz._id,
      questions: questions,
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
    await Result.create({
      userId: userId,
      userName: game.userName,
      quizId: game.quizId,
      score: game.score,
      totalQuestions: game.questions.length,
    });
    await Quiz.findByIdAndUpdate(game.quizId, { $inc: { plays: 1 } });

    await bot.telegram.sendMessage(
      game.chatId,
      `🏁 <b>Test yakunlandi!</b>\n👤 ${game.userName}\n✅ Natija: ${game.score} / ${game.questions.length}`,
      { parse_mode: "HTML" }
    );
  } catch (err) {}
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
  .then(() => console.log("🚀 Quiz Bot (Features Updated) ishga tushdi!"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
