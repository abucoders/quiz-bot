const { Scenes, Markup } = require("telegraf");
const Quiz = require("../models/Quiz");

// Vaqt variantlari
const timeOptions = [
  ["10 soniya", "15 soniya", "30 soniya"],
  ["45 soniya", "1 daqiqa", "2 daqiqa"],
  ["3 daqiqa", "4 daqiqa", "5 daqiqa"],
];

const importQuizScene = new Scenes.WizardScene(
  "import_quiz",

  // 1-QADAM: Test nomini so'rash
  async ctx => {
    await ctx.reply(
      "✍️ <b>Matn orqali test yuklash</b>\n\n" +
        "Test nomini yozing (Masalan: <i>Tarix 5-sinf</i>):",
      { parse_mode: "HTML", ...Markup.removeKeyboard() }
    );
    ctx.wizard.state.quiz = {};
    return ctx.wizard.next();
  },

  // 2-QADAM: Tavsif so'rash
  async ctx => {
    ctx.wizard.state.quiz.title = ctx.message.text;
    ctx.wizard.state.quiz.creatorId = ctx.from.id;
    ctx.wizard.state.quiz.questions = []; // Savollar ro'yxatini ochamiz

    await ctx.reply(
      "Yaxshi. Testga tavsif bering (yoki /skip):",
      Markup.keyboard([["/skip"]]).resize()
    );
    return ctx.wizard.next();
  },

  // 3-QADAM: SAVOL MATNINI KUTISH (START LOOP)
  async ctx => {
    // Tavsifni saqlash (faqat birinchi marta kirganda)
    if (typeof ctx.wizard.state.quiz.description === "undefined") {
      if (ctx.message.text !== "/skip") {
        ctx.wizard.state.quiz.description = ctx.message.text;
      } else {
        ctx.wizard.state.quiz.description = "";
      }
    }

    await ctx.reply(
      "Savollarni quyidagi formatda yozib yuboring:\n\n" +
        "<code>Savol matni\n" +
        "+To'g'ri javob\n" +
        "-Noto'g'ri javob\n" +
        "-Noto'g'ri javob</code>\n\n" +
        "<i>Har bir savol orasida bo'sh joy tashlang!</i>",
      {
        parse_mode: "HTML",
        ...Markup.keyboard([["✅ Tugatish", "🚫 Bekor qilish"]]).resize(),
      }
    );

    return ctx.wizard.next();
  },

  // 4-QADAM: PARSING VA QAROR QABUL QILISH
  async ctx => {
    const text = ctx.message.text;

    // A) Bekor qilish
    if (text === "🚫 Bekor qilish") {
      await ctx.reply("❌ Bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    // B) Tugatish (Agar savollar yetarli bo'lsa)
    if (text === "✅ Tugatish") {
      if (ctx.wizard.state.quiz.questions.length === 0) {
        await ctx.reply(
          "⚠️ Hali birorta ham savol qo'shilmadi. Matn yuboring."
        );
        return; // Qadamda qolamiz
      }
      // Vaqtni so'rashga o'tamiz
      await ctx.reply(
        "Savollar uchun vaqt belgilang:",
        Markup.keyboard(timeOptions).resize()
      );
      return ctx.wizard.next();
    }

    // C) Matnni analiz qilish (Parsing)
    const blocks = text.split(/\n\s*\n/); // Bo'sh qatorlar orqali ajratish
    let addedCount = 0;

    for (const block of blocks) {
      const lines = block
        .split("\n")
        .map(l => l.trim())
        .filter(l => l);
      if (lines.length < 3) continue;

      let questionText = lines[0];
      let options = [];
      let correctIndex = -1;
      let optionCounter = 0;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("+")) {
          options.push(line.substring(1).trim());
          correctIndex = optionCounter;
          optionCounter++;
        } else if (line.startsWith("-")) {
          options.push(line.substring(1).trim());
          optionCounter++;
        } else {
          questionText += " " + line;
        }
      }

      if (correctIndex !== -1 && options.length >= 2) {
        ctx.wizard.state.quiz.questions.push({
          question: questionText,
          options: options,
          correct_option_id: correctIndex,
          type: "quiz",
        });
        addedCount++;
      }
    }

    if (addedCount === 0) {
      await ctx.reply(
        "❌ Savol formatini tushunmadim. Qaytadan urinib ko'ring."
      );
      return; // Qadamda qolamiz
    }

    // Muvaffaqiyatli qo'shildi
    await ctx.reply(
      `✅ <b>${addedCount} ta savol qo'shildi!</b>\n` +
        `Jami savollar: ${ctx.wizard.state.quiz.questions.length} ta.\n\n` +
        `Yana davom ettirasizmi yoki tugatasizmi?`,
      {
        parse_mode: "HTML",
        ...Markup.keyboard([["📥 Yana qo'shish", "✅ Tugatish"]]).resize(),
      }
    );

    // Biz hozir 4-qadamdamiz. Keyingi xabarni kutish uchun shu yerda qolishimiz kerak.
    // Lekin Telegraf Wizard-da mantiqan keyingi qadamga o'tish kerak.
    // Shuning uchun biz kichik "o'tish" (Handler) yozamiz.
    return ctx.wizard.next();
  },

  // 5-QADAM: "YANA QO'SHISH" YOKI "VAQTGA O'TISH" HANDLERI
  async ctx => {
    const text = ctx.message.text;

    if (text === "📥 Yana qo'shish") {
      // 3-qadamga (Matn so'rashga) qaytamiz
      // Eslatma: WizardScene massiv indekslari 0 dan boshlanadi.
      // 0: Nom, 1: Tavsif, 2: Matn so'rash message, 3: Parsing logic
      // Biz 2-index (3-qadam)ga qaytishimiz kerak.
      ctx.wizard.selectStep(2);
      return ctx.wizard.steps[2](ctx);
    }

    if (text === "✅ Tugatish") {
      // Vaqtni so'rash
      await ctx.reply(
        "Savollar uchun vaqt belgilang:",
        Markup.keyboard(timeOptions).resize()
      );
      return ctx.wizard.next();
    }

    // Agar boshqa narsa yozsa (masalan yana savol tashlab yuborsa)
    await ctx.reply("Iltimos, tugmalardan birini tanlang.");
  },

  // 6-QADAM: VAQTNI QABUL QILISH
  async ctx => {
    const text = ctx.message.text;
    let seconds = 30;

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

  // 7-QADAM: SAQLASH VA YAKUNLASH
  async ctx => {
    const type = ctx.message.text;
    let shuffleQ = false;
    let shuffleO = false;

    if (type === "Faqat javoblar") shuffleO = true;
    if (type === "Savollar va javoblar") {
      shuffleQ = true;
      shuffleO = true;
    }

    try {
      const newQuiz = new Quiz({
        title: ctx.wizard.state.quiz.title,
        description: ctx.wizard.state.quiz.description,
        creatorId: ctx.from.id,
        questions: ctx.wizard.state.quiz.questions,
        settings: {
          time_limit: ctx.wizard.state.quiz.time_limit,
          shuffle_questions: shuffleQ,
          shuffle_options: shuffleO,
        },
      });

      await newQuiz.save();

      const link = `https://t.me/${ctx.botInfo.username}?start=${newQuiz._id}`;

      let statsText = `✅ <b>Test muvaffaqiyatli tuzildi!</b>\n\n`;
      statsText += `📝 Nomi: <b>${newQuiz.title}</b>\n`;
      statsText += `🖊 Savollar: ${newQuiz.questions.length} ta\n`;
      statsText += `⏱ Vaqt: ${ctx.wizard.state.quiz.time_limit} soniya\n`;
      statsText += `🔀 Aralashtirish: ${type}\n\n`;
      statsText += `🔗 <b>Ulashish havola:</b>\n${link}`;

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
              "Guruhda boshlash",
              `start=${newQuiz._id}`
            ),
          ],
          [
            Markup.button.callback(
              "🗑 O'chirish",
              `delete_quiz_${newQuiz._id}`
            ),
          ],
        ]),
      });

      // Menyuni qayta chiqarish
      await ctx.reply(
        "Bosh menyu:",
        Markup.keyboard([
          ["➕ Yangi test tuzish", "📥 Matn orqali - Free"],
          ["📚 Testlarimni ko'rish", "💰 Balans / Coin olish"],
          ["🏆 Top Reyting", "👤 Mening profilim"],
          ["📸 Rasm orqali test (AI) - NEW"],
          ["📂 Fayl yuklash (Doc/Excel) - NEW"],
        ]).resize()
      );
    } catch (err) {
      console.error(err);
      await ctx.reply("Xatolik yuz berdi.");
    }

    return ctx.scene.leave();
  }
);

module.exports = importQuizScene;
