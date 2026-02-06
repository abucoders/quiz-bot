const { Scenes, Markup } = require("telegraf");
const Quiz = require("../models/Quiz");

// Vaqt variantlari
const timeOptions = [
  ["10 soniya", "15 soniya", "30 soniya"],
  ["45 soniya", "1 daqiqa", "2 daqiqa"],
  ["3 daqiqa", "4 daqiqa", "5 daqiqa"],
];

const createQuizScene = new Scenes.WizardScene(
  "create_quiz",

  // 1. Nomini so'rash
  async ctx => {
    // Bekor qilish tekshiruvi (faqat shu qadamda /cancel ishlatamiz yoki tugma)
    if (ctx.message?.text === "🚫 Bekor qilish") {
      await ctx.reply("❌ Test tuzish bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    await ctx.reply(
      "Keling, yangi test tuzamiz. Test sarlavhasini yuboring:",
      Markup.keyboard([["🚫 Bekor qilish"]]).resize() //
    );
    ctx.wizard.state.quiz = {};
    return ctx.wizard.next();
  },

  // 2. Tavsif va Test tuzishni boshlash
  async ctx => {
    // Bekor qilish tekshiruvi
    if (ctx.message?.text === "🚫 Bekor qilish") {
      await ctx.reply("❌ Test tuzish bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    ctx.wizard.state.quiz.title = ctx.message.text;
    ctx.wizard.state.quiz.creatorId = ctx.from.id;
    ctx.wizard.state.quiz.questions = [];

    await ctx.reply(
      "Yaxshi. Endi test tavsifini yuboring (yoki o'tkazib yuborish uchun /skip bosing).",
      Markup.keyboard([["/skip"], ["🚫 Bekor qilish"]]).resize()
    );
    return ctx.wizard.next();
  },

  // 3. Savol qo'shish bosqichi (LOOP)
  async ctx => {
    // Bekor qilish tekshiruvi
    if (ctx.message?.text === "🚫 Bekor qilish") {
      await ctx.reply("❌ Test tuzish bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    // Tavsifni saqlash
    if (!ctx.wizard.state.quiz.description) {
      if (ctx.message.text && ctx.message.text !== "/skip") {
        ctx.wizard.state.quiz.description = ctx.message.text;
      } else {
        ctx.wizard.state.quiz.description = "";
      }
    }

    // Klaviatura
    const keyboard = Markup.keyboard([
      ["Savol tuzish"],
      ["/done", "/undo"],
      ["🚫 Bekor qilish"], //
    ]).resize();

    // Yo'riqnoma
    if (ctx.message && ctx.message.text === "Savol tuzish") {
      await ctx.reply(
        "📎 <b>Savol qo'shish uchun:</b>\n\n" +
          "1. Pastdagi <b>Skrepka (📎)</b> tugmasini bosing.\n" +
          "2. <b>Poll (So'rovnoma)</b> ni tanlang.\n" +
          "3. Savol va variantlarni yozing.\n" +
          "4. Pastga tushib <b>'Quiz Mode'</b> ni yoqing va to'g'ri javobni (ko'k tik ✅) belgilang.\n" +
          "5. <b>'Create'</b> tugmasini bosing.",
        { parse_mode: "HTML" }
      );
      return;
    }

    // POLL QABUL QILISH
    if (ctx.message && ctx.message.poll) {
      const poll = ctx.message.poll;

      if (poll.type !== "quiz") {
        await ctx.reply(
          "❌ Bu oddiy so'rovnoma. Iltimos, <b>'Quiz Mode'</b> ni yoqing.",
          { parse_mode: "HTML" }
        );
        return;
      }

      if (poll.is_anonymous) {
        await ctx.reply(
          "❌ <b>Xatolik:</b> Iltimos, <b>'Anonymous Voting'</b>ni O'CHIRIB yuboring.",
          { parse_mode: "HTML" }
        );
        return;
      }

      if (typeof poll.correct_option_id === "undefined") {
        await ctx.reply(
          "❌ To'g'ri javob belgilanmagan. Iltimos, javobni belgilab qayta yuboring."
        );
        return;
      }

      ctx.wizard.state.quiz.questions.push({
        question: poll.question,
        options: poll.options.map(o => o.text),
        correct_option_id: poll.correct_option_id,
        explanation: poll.explanation,
        type: "quiz",
      });

      await ctx.reply(
        `✅ <b>Savol qo'shildi!</b> (Jami: ${ctx.wizard.state.quiz.questions.length} ta)\n\nYana savol yuboring yoki tugatish uchun /done bosing.`,
        { parse_mode: "HTML", ...keyboard }
      );
      return;
    }

    // /done -> Keyingi qadam
    if (ctx.message && ctx.message.text === "/done") {
      if (ctx.wizard.state.quiz.questions.length === 0) {
        await ctx.reply("Hech bo'lmasa bitta savol qo'shing.");
        return;
      }

      await ctx.reply(
        "Savollar uchun vaqt belgilang.",
        Markup.keyboard([...timeOptions, ["🚫 Bekor qilish"]]).resize()
      );
      return ctx.wizard.next();
    }

    // /undo
    if (ctx.message && ctx.message.text === "/undo") {
      if (ctx.wizard.state.quiz.questions.length > 0) {
        ctx.wizard.state.quiz.questions.pop();
        await ctx.reply(
          `Oxirgi savol o'chirildi. Jami: ${ctx.wizard.state.quiz.questions.length}`
        );
      } else {
        await ctx.reply("Hali savol qo'shmagansiz.");
      }
      return;
    }

    await ctx.reply(
      "Yangi savol yuboring (Poll) yoki 'Savol tuzish' tugmasini bosing.",
      keyboard
    );
  },

  // 4. Vaqtni qabul qilish
  async ctx => {
    // Bekor qilish
    if (ctx.message?.text === "🚫 Bekor qilish") {
      await ctx.reply("❌ Test tuzish bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    const text = ctx.message.text;
    let seconds = 30; // Default

    if (text.includes("10")) seconds = 10;
    else if (text.includes("15")) seconds = 15;
    else if (text.includes("45")) seconds = 45;
    else if (text.includes("1 daqiqa")) seconds = 60;
    else if (text.includes("2 daqiqa")) seconds = 120;
    else if (text.includes("3 daqiqa")) seconds = 180;
    else if (text.includes("4 daqiqa")) seconds = 240;
    else if (text.includes("5 daqiqa")) seconds = 300;

    ctx.wizard.state.quiz.time_limit = seconds;

    await ctx.reply(
      "Savollar va javob variantlari aralashtirilsinmi?",
      Markup.keyboard([
        ["Faqat javoblar"],
        ["Savollar va javoblar"],
        ["Yo'q"],
        ["🚫 Bekor qilish"],
      ]).resize()
    );
    return ctx.wizard.next();
  },

  // 5. Aralashtirish va Saqlash
  async ctx => {
    // Bekor qilish
    if (ctx.message?.text === "🚫 Bekor qilish") {
      await ctx.reply("❌ Test tuzish bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    const type = ctx.message.text;
    let shuffleQ = false;
    let shuffleO = false;

    if (type === "Faqat javoblar") shuffleO = true;
    if (type === "Savollar va javoblar") {
      shuffleQ = true;
      shuffleO = true;
    }

    const quizData = {
      title: ctx.wizard.state.quiz.title,
      description: ctx.wizard.state.quiz.description,
      creatorId: ctx.from.id,
      questions: ctx.wizard.state.quiz.questions,
      settings: {
        time_limit: ctx.wizard.state.quiz.time_limit,
        shuffle_questions: shuffleQ,
        shuffle_options: shuffleO,
      },
    };

    try {
      const newQuiz = new Quiz(quizData);
      await newQuiz.save();

      const link = `https://t.me/${ctx.botInfo.username}?start=${newQuiz._id}`;

      let statsText = `<b>${newQuiz.title}</b>\n`;
      if (newQuiz.description) statsText += `<i>${newQuiz.description}</i>\n`;
      statsText += `\n🖊 ${newQuiz.questions.length} ta savol\n`;
      statsText += `⏱ ${quizData.settings.time_limit} soniya\n`;
      statsText += `🔀 ${type}\n\n`;
      statsText += `<b>Ulashish uchun havola:</b>\n${link}`;

      // Asosiy menyu tugmalari
      const mainMenuKeyboard = Markup.keyboard([
        ["➕ Yangi test tuzish", "📥 Matn orqali - Free"],
        ["📚 Testlarimni ko'rish", "💰 Balans / Coin olish"],
        ["🏆 Top Reyting", "👤 Mening profilim"],
        ["📸 Rasm orqali test (AI) - NEW"],
        ["📂 Fayl yuklash (Doc/Excel) - NEW"],
      ]).resize();

      // Testni boshqarish tugmalari (Inline)
      await ctx.reply(statsText, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "Bu testni boshlash",
              `start_quiz_${newQuiz._id}`
            ),
          ],
          [
            Markup.button.switchToChat(
              "Guruhda testni boshlash",
              `start=${newQuiz._id}`
            ),
          ],
          [
            Markup.button.url(
              "Testni ulashish",
              `https://t.me/share/url?url=${link}`
            ),
          ],
          [Markup.button.callback("Test statistikasi", `stats_${newQuiz._id}`)],
        ]),
      });

      // Menyuni qayta chiqarish uchun
      await ctx.reply("✅ Test muvaffaqiyatli saqlandi!", mainMenuKeyboard);
    } catch (error) {
      console.error("Saqlashda xatolik:", error);
      await ctx.reply("Testni saqlashda xatolik yuz berdi.");
    }

    return ctx.scene.leave();
  }
);

module.exports = createQuizScene;
