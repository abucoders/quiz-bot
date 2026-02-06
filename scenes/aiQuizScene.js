const { Scenes, Markup } = require("telegraf");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Quiz = require("../models/Quiz");
const axios = require("axios");

// ============================================================
// 🔑 API KALITLAR VA STATISTIKA
// ============================================================

// Kalitlarni shu yerga qo'ying
const rawKeys = [
  process.env.GEMINI_API_KEY, // 1-kalit
  "AIzaSyDIY3WHQ2uIoBqmEM8-B27wh91vm9X1vAU",
  "AIzaSyAC94f3ClYS7uKof_hXOiPCvuoU10cSL5s",
  "AIzaSyCSziIMTIchFzoVWBuf8XDbvmOjZyr1Aj0",
];

// Kalitlarni obyektga aylantiramiz (Statistika uchun)
// usage: muvaffaqiyatli ishlatildi
// errors: xato berdi (masalan limit tugadi)
const apiStats = rawKeys
  .filter(k => k && k.length > 10)
  .map(key => ({
    key: key,
    usage: 0,
    errors: 0,
    lastUsed: null,
  }));

// Tasodifiy kalit tanlash va hisoblagichni oshirish
function getGenAIInstance() {
  if (apiStats.length === 0) throw new Error("API Kalitlar yo'q");

  // Tasodifiy bitta kalitni olamiz
  const randomIndex = Math.floor(Math.random() * apiStats.length);
  const selectedKeyObj = apiStats[randomIndex];

  // Qaysi kalit tanlanganini qaytaramiz (index bilan, keyin statistika yozish uchun)
  return {
    genAI: new GoogleGenerativeAI(selectedKeyObj.key),
    index: randomIndex,
  };
}

const aiQuizScene = new Scenes.WizardScene(
  "ai_quiz_scene",

  // ============================================================
  // 1-QADAM: BOSHLASH VA RASM SO'RASH
  // ============================================================
  async ctx => {
    ctx.wizard.state.allQuestions = [];

    await ctx.reply(
      "📸 <b>AI Test rejimi</b>\n\n" +
        "Test rasmlarini birma-bir yuboring.\n" +
        "Men ularni tahlil qilib, umumiy bazaga yig'ib boraman.\n\n" +
        "<i>Rasm yuborishingiz mumkin 👇</i>",
      {
        parse_mode: "HTML",
        ...Markup.keyboard([["✅ Tugatish", "🚫 Bekor qilish"]]).resize(),
      }
    );
    return ctx.wizard.next();
  },

  // ============================================================
  // 2-QADAM: RASMLARNI QABUL QILISH
  // ============================================================
  async ctx => {
    const text = ctx.message?.text;

    // --- 🕵️‍♂️ ADMIN STATISTIKANI KO'RISHI UCHUN ---
    if (text === "/apistats") {
      // Admin ekanligini tekshiramiz
      if (ctx.from.id.toString() !== process.env.ADMIN_ID) {
        return ctx.reply("Bu ma'lumot faqat admin uchun!");
      }

      let msg = "📊 <b>API KALITLAR STATISTIKASI:</b>\n\n";
      apiStats.forEach((stat, i) => {
        // Kalitni yashirib ko'rsatamiz (oxirgi 4 ta harf)
        const maskedKey = "..." + stat.key.slice(-4);
        msg += `🔑 <b>Kalit ${i + 1}</b> (${maskedKey})\n`;
        msg += `✅ Ishladi: <b>${stat.usage}</b> marta\n`;
        msg += `❌ Xatolar: <b>${stat.errors}</b> ta\n\n`;
      });

      return ctx.reply(msg, { parse_mode: "HTML" });
    }
    // ---------------------------------------------

    if (text === "🚫 Bekor qilish") {
      await ctx.reply("❌ Jarayon bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    if (text === "✅ Tugatish") {
      if (ctx.wizard.state.allQuestions.length === 0) {
        await ctx.reply("⚠️ Hali birorta ham savol topilmadi. Rasm yuboring!");
        return;
      }
      await ctx.reply(
        `✅ <b>Rasmlar qabul qilindi!</b>\n` +
          `Jami yig'ilgan savollar: <b>${ctx.wizard.state.allQuestions.length} ta</b>.\n\n` +
          `Endi testga nom bering (Masalan: <i>Matematika 1-variant</i>):`,
        { parse_mode: "HTML", ...Markup.removeKeyboard() }
      );
      return ctx.wizard.next();
    }

    if (ctx.message?.photo) {
      const processingMsg = await ctx.reply("⏳ Rasm tahlil qilinmoqda...");

      // Stat uchun indeksni saqlab turamiz
      let currentKeyIndex = -1;

      try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const imageResponse = await axios.get(fileLink.href, {
          responseType: "arraybuffer",
        });
        const imageBuffer = Buffer.from(imageResponse.data).toString("base64");

        // --- YANGI API LOGIKASI ---
        const { genAI, index } = getGenAIInstance();
        currentKeyIndex = index; // Qaysi kalit ishlatilganini eslab qolamiz

        const model = genAI.getGenerativeModel({
          model: "gemini-3-flash-preview",
        });

        const prompt = `
          Sen o'zbek tilidagi testlarni tahlil qiluvchi botsan.
          Menga bu rasmdagi testlarni JSON formatida chiqarib ber.

          Quyidagi formatda bo'lsin:
          [
            {
              "question": "Savol matni",
              "options": ["Variant A", "Variant B", "Variant C", "Variant D"],
              "correct_option_id": 0
            }
          ]

          (Izoh: correct_option_id agar rasmda belgilangan bo'lsa o'shani ol, belgilanmagan bo'lsa mantiqan topib 0 ni yozib qo'y).
          Faqat JSON qaytar.
        `;

        const result = await model.generateContent([
          prompt,
          { inlineData: { data: imageBuffer, mimeType: "image/jpeg" } },
        ]);

        const response = await result.response;
        let resultText = response.text();
        resultText = resultText
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();
        const newQuestions = JSON.parse(resultText);

        if (!Array.isArray(newQuestions) || newQuestions.length === 0)
          throw new Error("Savol yo'q");

        // ✅ MUVAFFAQIYATLI -> Statistika +1
        if (currentKeyIndex !== -1) {
          apiStats[currentKeyIndex].usage += 1;
        }

        ctx.wizard.state.allQuestions.push(...newQuestions);

        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
        await ctx.reply(
          `✅ <b>Ushbu rasmdan ${newQuestions.length} ta savol qo'shildi!</b>\n` +
            `📊 Jami savollar: ${ctx.wizard.state.allQuestions.length} ta.\n\n` +
            `📸 <i>Yana rasm bo'lsa yuboring, bo'lmasa "✅ Tugatish" tugmasini bosing.</i>`,
          { parse_mode: "HTML" }
        );
      } catch (error) {
        console.error("AI Error:", error);

        // ❌ XATO -> Statistika (Error) +1
        if (currentKeyIndex !== -1) {
          apiStats[currentKeyIndex].errors += 1;
        }

        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
        await ctx.reply(
          `❌ <b>Bu rasmni o'qiy olmadim!</b>\n` +
            `Sifati past yoki unda test ko'rinmayapti.\n` +
            `Boshqa rasm yuborib ko'ring (Jarayon to'xtab qolmadi).`,
          {
            parse_mode: "HTML",
            reply_to_message_id: ctx.message.message_id, // Qaysi rasm xato bo'lsa o'shanga reply qiladi
          }
        );
      }
      return;
    }

    await ctx.reply("Rasm yuboring yoki '✅ Tugatish' ni bosing.");
  },

  // ============================================================
  // 3-QADAM: NOM BERISH VA SAQLASH
  // ============================================================
  async ctx => {
    const title = ctx.message.text;
    const questions = ctx.wizard.state.allQuestions;

    await ctx.reply("💾 Saqlanmoqda...");

    try {
      const newQuiz = new Quiz({
        title: title,
        description: "AI yordamida yaratilgan",
        creatorId: ctx.from.id,
        questions: questions.map(q => ({
          question: q.question,
          options: q.options,
          correct_option_id: q.correct_option_id || 0,
          type: "quiz",
        })),
        settings: {
          time_limit: 30,
          shuffle_questions: true,
          shuffle_options: true,
        },
      });

      await newQuiz.save();

      await ctx.reply(
        `🎉 Test tayyor!\n\n Nom: ${title}\nSavollar: ${questions.length} ta \n\n Tuzgan ${title} nomli testni "Testlarimni ko'rish" tugmasi orqali ko'rishingiz mumkin.`,
        Markup.keyboard([
          ["Yangi test tuzish", "📥 Matn orqali yuklash"],
          ["Testlarimni ko'rish", "👤 Mening profilim"],
          ["📸 Rasm orqali test (AI)"],
        ]).resize()
      );
    } catch (err) {
      await ctx.reply("Xatolik yuz berdi. Qayta urinib ko'ring.");
    }
    return ctx.scene.leave();
  }
);

module.exports = aiQuizScene;
