const { Scenes, Markup } = require("telegraf");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Quiz = require("../models/Quiz");
const axios = require("axios");

// Gemini ni sozlaymiz
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const aiQuizScene = new Scenes.WizardScene(
  "ai_quiz_scene",

  // ============================================================
  // 1-QADAM: BOSHLASH VA RASM SO'RASH
  // ============================================================
  async ctx => {
    // Savollar to'planadigan umumiy "savat"ni ochamiz
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
  // 2-QADAM: RASMLARNI QABUL QILISH (SIKL)
  // ============================================================
  async ctx => {
    const text = ctx.message?.text;

    // 1. BEKOR QILISH
    if (text === "🚫 Bekor qilish") {
      await ctx.reply("❌ Jarayon bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    // 2. TUGATISH (Agar rasm tashlab bo'lgan bo'lsa)
    if (text === "✅ Tugatish") {
      if (ctx.wizard.state.allQuestions.length === 0) {
        await ctx.reply("⚠️ Hali birorta ham savol topilmadi. Rasm yuboring!");
        return; // Qadamda qolamiz
      }

      // Keyingi qadamga o'tamiz (Nom qo'yishga)
      await ctx.reply(
        `✅ <b>Rasmlar qabul qilindi!</b>\n` +
          `Jami yig'ilgan savollar: <b>${ctx.wizard.state.allQuestions.length} ta</b>.\n\n` +
          `Endi testga nom bering (Masalan: <i>Matematika 1-variant</i>):`,
        { parse_mode: "HTML", ...Markup.removeKeyboard() }
      );
      return ctx.wizard.next();
    }

    // 3. RASM KELGANDA ISHLASH
    if (ctx.message?.photo) {
      const processingMsg = await ctx.reply("⏳ Rasm tahlil qilinmoqda...");

      try {
        // --- A) Rasmni yuklab olish ---
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const imageResponse = await axios.get(fileLink.href, {
          responseType: "arraybuffer",
        });
        const imageBuffer = Buffer.from(imageResponse.data).toString("base64");

        // --- B) Gemini ga yuborish ---
        // Eslatma: Model nomini to'g'ri yozamiz
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

        // JSON tozalash
        resultText = resultText
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();
        const newQuestions = JSON.parse(resultText);

        if (!Array.isArray(newQuestions) || newQuestions.length === 0) {
          throw new Error("Savol topilmadi");
        }

        // --- C) Savatlarga qo'shish ---
        ctx.wizard.state.allQuestions.push(...newQuestions);

        // Xabarni yangilash
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
        await ctx.reply(
          `✅ <b>Ushbu rasmdan ${newQuestions.length} ta savol qo'shildi!</b>\n` +
            `📊 Jami savollar: ${ctx.wizard.state.allQuestions.length} ta.\n\n` +
            `📸 <i>Yana rasm bo'lsa yuboring, bo'lmasa "✅ Tugatish" tugmasini bosing.</i>`,
          { parse_mode: "HTML" }
        );
      } catch (error) {
        console.error("AI Error:", error);
        // Xato bo'lsa, o'sha rasm haqida aytamiz
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

      // MUHIM: Biz next() qilmaymiz, chunki yana rasm kelishi mumkin.
      // Shu qadamda qolamiz.
      return;
    }

    // Agar matn yozsa va u buyruq bo'lmasa
    await ctx.reply("Iltimos, rasm yuboring yoki '✅ Tugatish' ni bosing.");
  },

  // ============================================================
  // 3-QADAM: NOM BERISH VA SAQLASH
  // ============================================================
  async ctx => {
    const title = ctx.message.text;
    const questions = ctx.wizard.state.allQuestions;

    await ctx.reply("💾 Test saqlanmoqda...");

    try {
      const newQuiz = new Quiz({
        title: title,
        description: "AI yordamida yaratilgan (Rasm orqali)",
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
        `🎉 <b>Test tayyor!</b>\n\n` +
          `📝 Nom: <b>${title}</b>\n` +
          `🔢 Savollar: <b>${questions.length} ta</b>`,
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
