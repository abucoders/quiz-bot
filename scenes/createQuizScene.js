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
    await ctx.reply(
      "Keling, yangi test tuzamiz. Test sarlavhasini yuboring:",
      Markup.removeKeyboard()
    );
    ctx.wizard.state.quiz = {};
    return ctx.wizard.next();
  },

  // 2. Tavsif va Test tuzishni boshlash
  async ctx => {
    ctx.wizard.state.quiz.title = ctx.message.text;
    ctx.wizard.state.quiz.creatorId = ctx.from.id;
    ctx.wizard.state.quiz.questions = [];

    await ctx.reply(
      "Yaxshi. Endi test tavsifini yuboring (yoki o'tkazib yuborish uchun /skip bosing).",
      Markup.keyboard([["/skip"]]).resize()
    );
    return ctx.wizard.next();
  },

  // 3. Savol qo'shish bosqichi (LOOP)
  async ctx => {
    // Tavsifni saqlash (agar avvalgi qadamdan kelsa)
    if (!ctx.wizard.state.quiz.description) {
      if (ctx.message.text && ctx.message.text !== "/skip") {
        ctx.wizard.state.quiz.description = ctx.message.text;
      } else {
        ctx.wizard.state.quiz.description = "";
      }
    }

    // Maxsus klaviatura
    const keyboard = Markup.keyboard([
      ["Savol tuzish"], // Siz so'ragan tugma
      ["/done", "/undo"],
    ]).resize();

    // Agar foydalanuvchi "Savol tuzish" tugmasini bossa
    if (ctx.message && ctx.message.text === "Savol tuzish") {
      await ctx.reply(
        "📎 <b>Savol qo'shish uchun:</b>\n\n" +
          "1. Pastdagi <b>Skrepka (📎)</b> tugmasini bosing.\n" +
          "2. <b>Poll (So'rovnoma)</b> ni tanlang.\n" +
          "3. Savol va variantlarni yozing.\n" +
          "4. Pastga tushib <b>'Quiz Mode'</b> (Viktorina rejimi) ni yoqing va to'g'ri javobni tanlang.\n" +
          "5. <b>'Create'</b> (Yaratish) tugmasini bosing.",
        { parse_mode: "HTML" }
      );
      return; // Qadamni o'zgartirmaymiz
    }

    // Agar foydalanuvchi Poll yuborsa
    if (ctx.message && ctx.message.poll) {
      const poll = ctx.message.poll;

      // --- TUZATISH 1: Debug va Return ---
      console.log("Kelgan poll:", poll); // Terminalda ko'rish uchun

      // 1. Quiz Mode tekshiruvi
      if (poll.type !== "quiz") {
        await ctx.reply(
          "❌ Bu oddiy so'rovnoma. Iltimos, pastdan <b>'Quiz Mode'</b> ni yoqib yuboring.",
          { parse_mode: "HTML" }
        );
        return; // <--- ENG MUHIM JOYI: SHU YERDA TO'XTASH KERAK!
      }

      // 2. To'g'ri javob borligini tekshirish
      if (typeof poll.correct_option_id === "undefined") {
        await ctx.reply(
          "❌ Siz to'g'ri javobni belgilamadingiz. So'rovnoma yaratishda variantlardan birini tanlab (ko'k tik ✅), keyin 'Create' tugmasini bosing."
        );
        return;
      }

      // Agar hammasi joyida bo'lsa, bazaga qo'shamiz
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

    // Agar /done bossa -> Vaqtni sozlashga o'tamiz
    if (ctx.message && ctx.message.text === "/done") {
      if (ctx.wizard.state.quiz.questions.length === 0) {
        await ctx.reply("Hech bo'lmasa bitta savol qo'shing.");
        return;
      }

      await ctx.reply(
        "Savollar uchun vaqt belgilang. Guruhlada bot vaqt tugashi bilan keyingi savolni yuboradi.",
        Markup.keyboard(timeOptions).resize()
      );
      return ctx.wizard.next();
    }

    // /undo bosilsa
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
      "Yangi savol yuboring (Poll ko'rinishida) yoki yo'riqnoma uchun 'Savol tuzish' ni bosing.",
      keyboard
    );
  },

  // 4. Vaqtni qabul qilish
  async ctx => {
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
      ]).resize()
    );
    return ctx.wizard.next();
  },

  // 5. Aralashtirish va Saqlash
  async ctx => {
    const type = ctx.message.text;
    let shuffleQ = false;
    let shuffleO = false;

    if (type === "Faqat javoblar") shuffleO = true;
    if (type === "Savollar va javoblar") {
      shuffleQ = true;
      shuffleO = true;
    }

    // Bazaga saqlash
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

    // --- TUZATISH 2: newQuiz yaratish ---
    try {
      const newQuiz = new Quiz(quizData); // <--- BU QATOR YO'Q EDI
      await newQuiz.save();

      // Yakuniy Dashboard
      const link = `https://t.me/${ctx.botInfo.username}?start=${newQuiz._id}`;

      let statsText = `<b>${newQuiz.title}</b>\n`;
      if (newQuiz.description) statsText += `<i>${newQuiz.description}</i>\n`;
      statsText += `\n🖊 ${newQuiz.questions.length} ta savol\n`;
      statsText += `⏱ ${quizData.settings.time_limit} soniya\n`;
      statsText += `🔀 ${type}\n\n`;
      statsText += `<b>Ulashish uchun havola:</b>\n${link}`;

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
    } catch (error) {
      console.error("Saqlashda xatolik:", error);
      await ctx.reply("Testni saqlashda xatolik yuz berdi.");
    }

    return ctx.scene.leave();
  }
);

module.exports = createQuizScene;
