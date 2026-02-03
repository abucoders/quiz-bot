const { Scenes, Markup } = require("telegraf");
const Quiz = require("../models/Quiz");

// ==========================================
// 1. SARLAVHANI TAHRIRLASH SAHNASI
// ==========================================
const editTitleScene = new Scenes.WizardScene(
  "edit_quiz_title",
  async ctx => {
    await ctx.reply("📝 <b>Yangi sarlavhani yuboring:</b>", {
      parse_mode: "HTML",
      ...Markup.keyboard([["🚫 Bekor qilish"]]).resize(),
    });
    return ctx.wizard.next();
  },
  async ctx => {
    if (ctx.message?.text === "🚫 Bekor qilish") {
      await ctx.reply("Bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    const newTitle = ctx.message.text;
    const quizId = ctx.session.editQuizId; // ID ni sessiyadan olamiz

    await Quiz.findByIdAndUpdate(quizId, { title: newTitle });

    await ctx.reply(
      "✅ <b>Sarlavha o'zgartirildi!</b>",
      Markup.removeKeyboard()
    );

    // Tahrirlash menyusiga qaytamiz
    return returnToEditMenu(ctx, quizId);
  }
);

// ==========================================
// 2. TAVSIFNI TAHRIRLASH SAHNASI
// ==========================================
const editDescScene = new Scenes.WizardScene(
  "edit_quiz_desc",
  async ctx => {
    await ctx.reply("📝 <b>Yangi tavsifni yuboring (yoki /delete):</b>", {
      parse_mode: "HTML",
      ...Markup.keyboard([["🚫 Bekor qilish"]]).resize(),
    });
    return ctx.wizard.next();
  },
  async ctx => {
    if (ctx.message?.text === "🚫 Bekor qilish") {
      await ctx.reply("Bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    let newDesc = ctx.message.text;
    if (newDesc === "/delete") newDesc = "";

    const quizId = ctx.session.editQuizId;
    await Quiz.findByIdAndUpdate(quizId, { description: newDesc });

    await ctx.reply("✅ <b>Tavsif yangilandi!</b>", Markup.removeKeyboard());
    return returnToEditMenu(ctx, quizId);
  }
);

// ==========================================
// 3. TAYMERNI TAHRIRLASH SAHNASI
// ==========================================
const timeOptions = [
  ["10 soniya", "15 soniya", "30 soniya"],
  ["45 soniya", "1 daqiqa", "2 daqiqa"],
  ["3 daqiqa", "4 daqiqa", "5 daqiqa"],
];

const editTimerScene = new Scenes.WizardScene(
  "edit_quiz_timer",
  async ctx => {
    await ctx.reply("⏱ <b>Yangi vaqtni tanlang:</b>", {
      parse_mode: "HTML",
      ...Markup.keyboard([...timeOptions, ["🚫 Bekor qilish"]]).resize(),
    });
    return ctx.wizard.next();
  },
  async ctx => {
    const text = ctx.message.text;
    if (text === "🚫 Bekor qilish") {
      await ctx.reply("Bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    let seconds = 30;
    if (text.includes("10")) seconds = 10;
    else if (text.includes("15")) seconds = 15;
    else if (text.includes("30")) seconds = 30;
    else if (text.includes("45")) seconds = 45;
    else if (text.includes("1 daqiqa")) seconds = 60;
    else if (text.includes("2 daqiqa")) seconds = 120;
    else if (text.includes("3 daqiqa")) seconds = 180;
    else if (text.includes("4 daqiqa")) seconds = 240;
    else if (text.includes("5 daqiqa")) seconds = 300;

    const quizId = ctx.session.editQuizId;
    await Quiz.findByIdAndUpdate(quizId, { "settings.time_limit": seconds });

    await ctx.reply(
      `✅ <b>Vaqt ${seconds} soniyaga o'zgartirildi!</b>`,
      Markup.removeKeyboard()
    );
    return returnToEditMenu(ctx, quizId);
  }
);

// ==========================================
// 4. ARALASHTIRISHNI TAHRIRLASH
// ==========================================
const editShuffleScene = new Scenes.WizardScene(
  "edit_quiz_shuffle",
  async ctx => {
    await ctx.reply("🔀 <b>Aralashtirish rejimini tanlang:</b>", {
      parse_mode: "HTML",
      ...Markup.keyboard([
        ["Faqat javoblar"],
        ["Savollar va javoblar"],
        ["Yo'q"],
        ["🚫 Bekor qilish"],
      ]).resize(),
    });
    return ctx.wizard.next();
  },
  async ctx => {
    const type = ctx.message.text;
    if (type === "🚫 Bekor qilish") {
      await ctx.reply("Bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    let shuffleQ = false;
    let shuffleO = false;

    if (type === "Faqat javoblar") shuffleO = true;
    if (type === "Savollar va javoblar") {
      shuffleQ = true;
      shuffleO = true;
    }

    const quizId = ctx.session.editQuizId;
    await Quiz.findByIdAndUpdate(quizId, {
      "settings.shuffle_questions": shuffleQ,
      "settings.shuffle_options": shuffleO,
    });

    await ctx.reply(`✅ <b>Sozlamalar saqlandi!</b>`, Markup.removeKeyboard());
    return returnToEditMenu(ctx, quizId);
  }
);

// ==========================================
// 5. SAVOL QO'SHISH (QUICK ADD)
// ==========================================
const addQuestionScene = new Scenes.WizardScene(
  "add_quiz_question",
  async ctx => {
    await ctx.reply(
      "➕ <b>Yangi savol qo'shish</b>\n\n" +
        "Savolni formatda yuboring:\n\n" +
        "<code>Savol matni?\nTo'g'ri javob\nXato javob\nXato javob...</code>\n\n" +
        "⚠️ To'g'ri javob birinchi bo'lishi kerak!",
      { parse_mode: "HTML", ...Markup.keyboard([["🚫 Bekor qilish"]]).resize() }
    );
    return ctx.wizard.next();
  },
  async ctx => {
    if (ctx.message.text === "🚫 Bekor qilish") {
      await ctx.reply("Bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    const lines = ctx.message.text
      .split("\n")
      .map(l => l.trim())
      .filter(l => l);
    if (lines.length < 3) {
      await ctx.reply("❌ Format xato! Kamida savol va 2 ta javob bo'lsin.");
      return;
    }

    const newQuestion = {
      question: lines[0],
      options: [lines[1], ...lines.slice(2)],
      correct_option_id: 0,
      type: "quiz",
    };

    const quizId = ctx.session.editQuizId;
    await Quiz.findByIdAndUpdate(quizId, { $push: { questions: newQuestion } });

    await ctx.reply("✅ <b>Savol qo'shildi!</b>", Markup.removeKeyboard());
    return returnToEditMenu(ctx, quizId);
  }
);

// YORDAMCHI: Menyu qaytarish funksiyasi
async function returnToEditMenu(ctx, quizId) {
  ctx.scene.leave(); // Sahnadan chiqamiz

  // Simulyatsiya qilingan "Callback" orqali menyuni yangilaymiz
  // Lekin userga yangi menyu tashlaymiz, chunki keyboardlar o'zgargan bo'lishi mumkin
  const quiz = await Quiz.findById(quizId);

  let msg = `⚙️ <b>TAHRIRLASH: ${quiz.title}</b>\n\n`;
  msg += `🖊 Savollar: ${quiz.questions.length} ta\n`;
  msg += `⏱ Vaqt: ${quiz.settings.time_limit} soniya\n`;

  await ctx.reply(msg, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "📝 Savollarni tahrirlash",
          `edit_qs_menu_${quiz._id}`
        ),
      ],
      [
        Markup.button.callback(
          "✏️ Sarlavhani tahrirlash",
          `edit_title_${quiz._id}`
        ),
      ],
      [
        Markup.button.callback(
          "📝 Tavsifni tahrirlash",
          `edit_desc_${quiz._id}`
        ),
      ],
      [
        Markup.button.callback(
          "⏱ Taymer sozlamalari",
          `edit_timer_${quiz._id}`
        ),
      ],
      [
        Markup.button.callback(
          "🔀 Aralashtirish sozlamalari",
          `edit_shuffle_${quiz._id}`
        ),
      ],
      [Markup.button.callback("« Orqaga", `view_quiz_menu_${quiz._id}`)],
    ]),
  });
}

module.exports = {
  editTitleScene,
  editDescScene,
  editTimerScene,
  editShuffleScene,
  addQuestionScene,
};
