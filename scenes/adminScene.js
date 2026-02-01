const { Scenes, Markup } = require("telegraf");
const User = require("../models/User");

const adminScene = new Scenes.WizardScene(
  "admin_broadcast",

  // 1-QADAM: Xabarni so'rash
  async ctx => {
    await ctx.reply(
      "📢 <b>Xabar tarqatish rejimi</b>\n\n" +
        "Barcha foydalanuvchilarga yubormoqchi bo'lgan xabaringizni kiriting (Matn, Rasm, Video, Audio...):\n\n" +
        "<i>Bekor qilish uchun tugmani bosing.</i>",
      {
        parse_mode: "HTML",
        ...Markup.keyboard([["🚫 Bekor qilish"]]).resize(),
      }
    );
    return ctx.wizard.next();
  },

  // 2-QADAM: Xabarni qabul qilish va Tasdiqlash
  async ctx => {
    // --- TUZATISH: Xabar borligini tekshiramiz ---
    if (!ctx.message) return;

    // Bekor qilish tekshiruvi (Rasmda text bo'lmaydi, shuning uchun optional chaining ?.)
    if (ctx.message.text === "🚫 Bekor qilish") {
      await ctx.reply("Bekor qilindi.", Markup.removeKeyboard());
      return ctx.scene.leave();
    }

    // Xabarni vaqtincha saqlaymiz
    ctx.wizard.state.messageId = ctx.message.message_id;
    ctx.wizard.state.chatId = ctx.chat.id;

    await ctx.reply(
      "Xabar qabul qilindi. Barchaga yuborilsinmi?",
      Markup.keyboard([["✅ Ha, yuborilsin", "🚫 Yo'q, bekor qilish"]]).resize()
    );
    return ctx.wizard.next();
  },

  // 3-QADAM: YUBORISH (BROADCAST)
  async ctx => {
    // Bu yerda ham xabar borligini tekshiramiz
    if (!ctx.message || !ctx.message.text) return;

    if (ctx.message.text === "✅ Ha, yuborilsin") {
      const users = await User.find(); // Bazadagi hamma odamni olamiz
      let success = 0;
      let blocked = 0;

      await ctx.reply(`🚀 Yuborish boshlandi... (Jami: ${users.length} ta)`);

      for (const user of users) {
        try {
          // copyMessage - xabarni original holida (rasm/video bo'lsa ham) ko'chiradi
          await ctx.telegram.copyMessage(
            user.telegramId,
            ctx.wizard.state.chatId,
            ctx.wizard.state.messageId
          );
          success++;
          // Spamga tushmaslik uchun ozgina kutamiz (50ms)
          await new Promise(r => setTimeout(r, 50));
        } catch (e) {
          blocked++; // Botni bloklaganlar
        }
      }

      await ctx.reply(
        `✅ <b>Xabar tarqatildi!</b>\n\n` +
          `🟢 Yetib bordi: ${success} ta\n` +
          `🔴 Bloklangan/Xato: ${blocked} ta`,
        { parse_mode: "HTML", ...Markup.removeKeyboard() }
      );
    } else {
      await ctx.reply("❌ Bekor qilindi.", Markup.removeKeyboard());
    }
    return ctx.scene.leave();
  }
);

module.exports = adminScene;
