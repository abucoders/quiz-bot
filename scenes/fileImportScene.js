const { Scenes, Markup } = require("telegraf");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Quiz = require("../models/Quiz");
const axios = require("axios");
const xlsx = require("xlsx");
const mammoth = require("mammoth");
const pdf = require("pdf-parse");

// ============================================================
// 🔑 API KALITLARNI BOSHQARISH TIZIMI
// ============================================================

// Kalitlarni shu yerga qo'ying
const API_KEYS = [
  process.env.GEMINI_API_KEY, // 1-kalit
  "AIzaSyDIY3WHQ2uIoBqmEM8-B27wh91vm9X1vAU",
  "AIzaSyAC94f3ClYS7uKof_hXOiPCvuoU10cSL5s",
  "AIzaSyCSziIMTIchFzoVWBuf8XDbvmOjZyr1Aj0",
];

// Tasodifiy kalit tanlaydigan funksiya
function getRandomGenAI() {
  const validKeys = API_KEYS.filter(k => k && k.length > 10);

  if (validKeys.length === 0) {
    console.error("XATO: Birorta ham API kalit topilmadi!");
    throw new Error("API Kalitlar yo'q");
  }

  const randomKey = validKeys[Math.floor(Math.random() * validKeys.length)];
  return new GoogleGenerativeAI(randomKey);
}

const fileImportScene = new Scenes.WizardScene(
  "file_import_scene",

  // 1-QADAM: Fayl so'rash
  async ctx => {
    await ctx.reply(
      "📂 <b>Fayl orqali test yuklash</b>\n\n" +
        "Menga quyidagi formatlardan birini yuboring:\n" +
        "✅ <b>.xlsx</b> (Excel) - <i>Tavsiya etiladi (Aniqroq)</i>\n" +
        "✅ <b>.docx</b> (Word)\n" +
        "✅ <b>.pdf</b> (PDF)\n\n" +
        "⚠️ <i>Fayl hajmi 20 MB dan oshmasligi kerak.</i>",
      { parse_mode: "HTML", ...Markup.keyboard([["🚫 Bekor qilish"]]).resize() }
    );
    return ctx.wizard.next();
  },

  // 2-QADAM: Faylni qabul qilish va ishlash
  async ctx => {
    if (ctx.message?.text === "🚫 Bekor qilish") {
      await ctx.reply("Bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    if (!ctx.message?.document) {
      await ctx.reply("Iltimos, fayl (Document) ko'rinishida yuboring.");
      return;
    }

    const doc = ctx.message.document;
    const fileName = doc.file_name.toLowerCase();
    const fileId = doc.file_id;

    const processingMsg = await ctx.reply(
      "⏳ <b>Fayl yuklanmoqda va tahlil qilinmoqda...</b>\nBu biroz vaqt olishi mumkin.",
      { parse_mode: "HTML" }
    );

    try {
      // 1. Faylni yuklab olamiz
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const response = await axios.get(fileLink.href, {
        responseType: "arraybuffer",
      });
      const buffer = Buffer.from(response.data);

      let allQuestions = [];

      // 2. Formatga qarab o'qiymiz
      if (fileName.endsWith(".xlsx")) {
        allQuestions = parseExcel(buffer);
      } else if (fileName.endsWith(".docx")) {
        const text = await parseDocx(buffer);
        // Word bo'lsa AI ishlatamiz
        allQuestions = await parseWithAI(text);
      } else if (fileName.endsWith(".pdf")) {
        const text = await parsePdf(buffer);
        // PDF bo'lsa AI ishlatamiz
        allQuestions = await parseWithAI(text);
      } else {
        await ctx.telegram
          .deleteMessage(ctx.chat.id, processingMsg.message_id)
          .catch(() => {});
        await ctx.reply(
          "❌ Noto'g'ri format! Faqat .xlsx, .docx yoki .pdf yuboring."
        );
        return;
      }

      if (!allQuestions || allQuestions.length === 0) {
        await ctx.telegram
          .deleteMessage(ctx.chat.id, processingMsg.message_id)
          .catch(() => {});
        await ctx.reply(
          "❌ Fayldan hech qanday test topa olmadim. Formatni tekshiring."
        );
        return ctx.scene.leave();
      }

      // 3. Testlarni 50 tadan bo'lib saqlash
      const CHUNK_SIZE = 50;
      const totalParts = Math.ceil(allQuestions.length / CHUNK_SIZE);
      const baseTitle = fileName.split(".")[0]; // Fayl nomini olamiz

      let msg = `✅ <b>Jami ${allQuestions.length} ta savol topildi!</b>\n\n`;
      msg += `Ular <b>${totalParts} ta</b> alohida testga bo'lindi:\n`;

      for (let i = 0; i < totalParts; i++) {
        // 50 tadan qirqib olamiz
        const chunk = allQuestions.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);

        const partNumber = i + 1;
        const quizTitle = `${baseTitle} (${partNumber}-qism)`;

        const newQuiz = new Quiz({
          title: quizTitle,
          description: `Fayldan yuklandi: ${fileName}`,
          creatorId: ctx.from.id,
          questions: chunk,
          settings: {
            time_limit: 30,
            shuffle_questions: true,
            shuffle_options: true,
          },
        });

        await newQuiz.save();
        msg += `🔹 <b>${quizTitle}</b> (${chunk.length} savol) - Saqlandi!\n`;
      }

      await ctx.telegram
        .deleteMessage(ctx.chat.id, processingMsg.message_id)
        .catch(() => {});
      await ctx.reply(msg, { parse_mode: "HTML", ...Markup.removeKeyboard() });

      // Asosiy menyuga qaytamiz
      await ctx.reply(
        "Yana nima qilamiz?",
        Markup.keyboard([
          ["Yangi test tuzish", "📥 Matn orqali yuklash"],
          ["Testlarimni ko'rish", "👤 Mening profilim"],
          ["📸 Rasm orqali test (AI)"],
          ["📂 Fayl yuklash (Doc/Excel)"],
        ]).resize()
      );

      return ctx.scene.leave();
    } catch (err) {
      console.error("File Error:", err);
      await ctx.telegram
        .deleteMessage(ctx.chat.id, processingMsg.message_id)
        .catch(() => {});
      await ctx.reply(
        "❌ Xatolik yuz berdi. Fayl buzilgan yoki AI o'qiy olmadi."
      );
      return ctx.scene.leave();
    }
  }
);

// ==========================================
// YORDAMCHI FUNKSIYALAR
// ==========================================

// 1. Excelni o'qish (AI kerak emas, aniq ishlaydi)
function parseExcel(buffer) {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

  const questions = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row && row[0]) {
      const questionText = row[0];
      const options = [row[1], row[2], row[3], row[4]].filter(Boolean);

      if (options.length >= 2) {
        questions.push({
          question: questionText,
          options: options,
          correct_option_id: 0,
          type: "quiz",
        });
      }
    }
  }
  return questions;
}

// 2. Word (.docx) matnini olish
async function parseDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer: buffer });
  return result.value;
}

// 3. PDF matnini olish
async function parsePdf(buffer) {
  const data = await pdf(buffer);
  return data.text;
}

// 4. Matnni AI orqali JSON qilish (Word va PDF uchun)
async function parseWithAI(text) {
  // Matn juda uzun bo'lsa, uni kesib olish kerak (Gemini limiti bor)
  const slicedText = text.slice(0, 60000);

  // 🔥 MUHIM: Har safar random kalit olamiz
  const genAI = getRandomGenAI();
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
    Quyidagi matndan test savollarini ajratib ol va JSON formatida ber.
    Matn ichida savollar, variantlar va javoblar bor.

    Qaytariladigan format:
    [
      {
        "question": "Savol matni",
        "options": ["Variant 1", "Variant 2", "Variant 3", "Variant 4"],
        "correct_option_id": 0
      }
    ]

    Muhim:
    1. Variantlar ichidan to'g'ri javobni aniqlab, uni options ro'yxatiga qo'sh va indeksini ko'rsat (0, 1, 2 yoki 3).
    2. Faqat JSON massiv qaytar.

    Matn:
    ${slicedText}
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let jsonText = response
      .text()
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(jsonText);
  } catch (e) {
    console.error("AI Parse Error inside function:", e);
    throw e; // Xatoni yuqoriga uzatamiz
  }
}

module.exports = fileImportScene;
