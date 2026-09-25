export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    try {
      const update = await request.json();

      if (update.callback_query) {
        await handleCallback(update.callback_query, env);
      } else if (update.message) {
        await handleMessage(update.message, env);
      }
    } catch (err) {
      console.error("Worker Global Error:", err);
    }

    return new Response("OK");
  },
};

// Telegram API Helper
async function tg(env, method, payload) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// မြန်မာစံတော်ချိန် (UTC+6:30) Helper
function formatMyanmarTime(dateObj) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Yangon",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(dateObj);
  } catch (e) {
    return dateObj.toISOString();
  }
}

// User Record ရယူခြင်း/မရှိပါက အသစ်ဆောက်ခြင်း
async function getOrCreateUser(env, from) {
  let user = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(from.id).first();
  if (!user) {
    await env.DB.prepare(
      "INSERT INTO users (telegram_id, username, first_name, balance, is_banned, pending_topup_amount, total_orders) VALUES (?, ?, ?, 0, 0, 0, 0)"
    ).bind(from.id, from.username || "Unknown", from.first_name || "").run();
    user = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(from.id).first();
  }
  return user;
}

// Main Menu Generator
function getMainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🛍 Buy Outline Key", callback_data: "menu_buy" },
        { text: "🎁 Test Key", callback_data: "menu_test_key" }
      ],
      [
        { text: "💳 Top Up", callback_data: "menu_topup" },
        { text: "💵 Balance", callback_data: "menu_balance" }
      ],
      [
        { text: "👤 Profile", callback_data: "menu_profile" },
        { text: "📜 Terms", callback_data: "menu_terms" }
      ],
      [
        { text: "💬 Support", url: "https://t.me/JaiwaJG" }
      ]
    ]
  };
}

// Message & Command Handler
async function handleMessage(msg, env) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || "").trim();
  const paymentGroupId = String(env.PAYMENT_GROUP_ID || "").trim();
  const stockGroupId = String(env.STOCK_GROUP_ID || "").trim();

  // --- ၁။ USER SIDE: PRIVATE CHAT ---
  if (!chatId.startsWith("-")) {
    const user = await getOrCreateUser(env, msg.from);

    // Ban ခံထားရသော User စစ်ဆေးခြင်း
    if (user.is_banned === 1) {
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: "🚫 <b>သင်သည် စည်းကမ်းဖောက်ဖျက်မှု (ငွေလွှဲပြေစာအတု ပေးပို့မှု) ကြောင့် Bot အသုံးပြုခွင့် ပိတ်ပင် (Ban) ခံထားရပါသည်။</b>",
        parse_mode: "HTML",
      });
      return;
    }

    // /start command
    if (text === "/start") {
      await env.DB.prepare("UPDATE users SET pending_topup_amount = 0 WHERE telegram_id = ?").bind(user.telegram_id).run();

      const welcomeText = 
        `👋 မင်္ဂလာပါ <b>${msg.from.first_name || ""}</b> ✨\n\n` +
        `Outline VPN Automated Store မှ ကြိုဆိုပါသည်။\n` +
        `မိမိ လိုအပ်သော ဝန်ဆောင်မှုကို အောက်ပါ Menu မှ ရွေးချယ်နိုင်ပါသည် 👇`;

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: welcomeText,
        parse_mode: "HTML",
        reply_markup: getMainKeyboard(),
      });
      return;
    }

    // စိတ်ကြိုက် Amount စာရိုက်ထည့်ခြင်း (အနည်းဆုံး 2,500 Ks စစ်ဆေးမှု)
    if (user.pending_topup_amount === -1 && text) {
      const cleanNum = text.replace(/,/g, "").trim();
      const amount = parseInt(cleanNum, 10);

      if (isNaN(amount) || amount < 2500) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: "⚠️ <b>မှားယွင်းနေပါသည်!</b>\n\nအနည်းဆုံး ငွေဖြည့်သွင်းငွေ ပမာဏမှာ <b>2,500 Ks</b> ဖြစ်ပါသည်။\nကျေးဇူးပြု၍ ကိန်းဂဏန်းသီးသန့် (ဥပမာ - <code>2500</code>, <code>5000</code>, <code>15000</code>) ဟု ရိုက်ထည့်ပေးပါခင်ဗျာ။",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
            ]
          }
        });
        return;
      }

      await env.DB.prepare("UPDATE users SET pending_topup_amount = ? WHERE telegram_id = ?").bind(amount, user.telegram_id).run();

      const payInfoMsg = 
        `💳 <b>ငွေလွှဲရန် အချက်အလက်များ</b>\n\n` +
        `💰 လွှဲရမည့် ပမာဏ: <b>${amount.toLocaleString()} Ks</b>\n\n` +
        `📱 <b>KBZPay | AYAPay \n </b> <code>09456545321</code> (Gum Seng Lat)\n` +
        `<i>(ဖုန်းနံပါတ်ကို tap နှိပ်၍ အလွယ်တကူ Copy ယူနိုင်ပါသည်)</i>\n\n` +
        `⚠️ <b>အရေးကြီးသော စည်းကမ်းချက်များ:</b>\n` +
        `• ငွေလွှဲမှတ်ချက် (Note) တွင် VPN / Outline စာသားများ <b>လုံးဝ မရေးပါနှင့်</b>။\n` +
        `• အထက်ဖော်ပြပါ ပမာဏအတိုင်း အတိအကျ လွှဲပေးပါ။\n` +
        `• ငွေလွှဲပြီးပါက ပြေစာ <b>Screenshot (ဓာတ်ပုံ)</b> ကို ဤ Chat ထဲသို့ ပို့ပေးပါ။\n` +
        `• ပြေစာအတု ပို့ဆောင်ပါက Bot အား အပြီးအပိုင် <b>Ban</b> ပြုလုပ်ပါမည်။\n\n` +
        `👉 <i>ယခု ငွေလွှဲပြေစာ ဓာတ်ပုံကို ပေးပို့နိုင်ပါပြီ-</i>`;

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: payInfoMsg,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 ပမာဏ ပြန်ရွေးမည်", callback_data: "menu_topup" }]
          ]
        }
      });
      return;
    }

    // ငွေလွှဲစလစ် (Photo) လက်ခံခြင်း
    if (msg.photo && msg.photo.length > 0) {
      const currentAmt = Number(user.pending_topup_amount || 0);

      if (currentAmt <= 0) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: "⚠️ ကျေးဇူးပြု၍ ပြေစာမပို့မီ အောက်ပါ Menu ထဲရှိ <b>💳 Top Up</b> ခလုတ်ကို နှိပ်ပြီး ဖြည့်သွင်းမည့် ပမာဏကို အရင် ရွေးချယ်ပေးပါခင်ဗျာ။",
          parse_mode: "HTML",
          reply_markup: getMainKeyboard(),
        });
        return;
      }

      const photo = msg.photo[msg.photo.length - 1];

      const res = await env.DB.prepare(
        "INSERT INTO topup_requests (user_id, amount, slip_file_id) VALUES (?, ?, ?)"
      ).bind(user.telegram_id, currentAmt, photo.file_id).run();

      const requestId = res.meta?.last_row_id || Date.now();

      await env.DB.prepare("UPDATE users SET pending_topup_amount = 0 WHERE telegram_id = ?").bind(user.telegram_id).run();

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `⏳ <b>ငွေလွှဲပြေစာ လက်ခံရရှိပါပြီ!</b>\n\nဖြည့်သွင်းငွေ: <b>${currentAmt.toLocaleString()} Ks</b>\nAdmin Team မှ စစ်ဆေးပြီးပါက Wallet ထဲသို့ ငွေအလိုအလျောက် ရောက်ရှိလာပါမည် ခင်ဗျာ။`,
        parse_mode: "HTML",
      });

      if (paymentGroupId) {
        const captionText = 
          `📩 <b>ငွေဖြည့်တောင်းဆိုမှု အသစ် (#ID_${requestId})</b>\n\n` +
          `• <b>User:</b> ${msg.from.first_name || ""} (<code>${user.telegram_id}</code>)\n` +
          `• <b>Username:</b> @${msg.from.username || "None"}\n` +
          `• <b>ဖြည့်သွင်းမည့် ပမာဏ:</b> <b>${currentAmt.toLocaleString()} Ks</b>\n` +
          `• <b>အချိန်:</b> ${formatMyanmarTime(new Date())}\n\n` +
          `👇 <i>ပြေစာပုံနှင့် ပမာဏ ကိုက်ညီပါက Approve နှိပ်ပါ:</i>`;

        await tg(env, "sendPhoto", {
          chat_id: paymentGroupId,
          photo: photo.file_id,
          caption: captionText,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: `✅ Approve (${currentAmt.toLocaleString()} Ks)`, callback_data: `pay_app_${requestId}_${user.telegram_id}_${currentAmt}` }],
              [
                { text: "❌ Reject", callback_data: `pay_rej_${requestId}_${user.telegram_id}` },
                { text: "🚫 Ban User", callback_data: `pay_ban_${user.telegram_id}` }
              ]
            ]
          }
        });
      }
      return;
    }
  }

  // --- ၂။ PAYMENT GROUP SIDE COMMANDS ---
  if (paymentGroupId && chatId === paymentGroupId) {
    if (text.startsWith("/ban")) {
      const parts = text.split(" ");
      const targetId = parts[1]?.trim();
      if (targetId) {
        await env.DB.prepare("UPDATE users SET is_banned = 1 WHERE telegram_id = ?").bind(targetId).run();
        await tg(env, "sendMessage", { chat_id: chatId, text: `🚫 User <code>${targetId}</code> အား Ban လုပ်ပြီးပါပြီ။`, parse_mode: "HTML" });
      }
      return;
    }
    if (text.startsWith("/unban")) {
      const parts = text.split(" ");
      const targetId = parts[1]?.trim();
      if (targetId) {
        await env.DB.prepare("UPDATE users SET is_banned = 0 WHERE telegram_id = ?").bind(targetId).run();
        await tg(env, "sendMessage", { chat_id: chatId, text: `✅ User <code>${targetId}</code> အား Unban လုပ်ပြီးပါပြီ။`, parse_mode: "HTML" });
      }
      return;
    }
  }

  // --- ၃။ STOCK GROUP SIDE COMMANDS ---
  if (stockGroupId && chatId === stockGroupId) {
    const cleanCmd = text.split("@")[0].split(" ")[0].split("\n")[0];

    if (cleanCmd === "/stock") {
      const counts = await env.DB.prepare(
        "SELECT category, COUNT(*) as count FROM keys GROUP BY category"
      ).all();

      let stockMap = { test: 0, "50gb": 0, "100gb": 0, "250gb": 0 };
      if (counts.results) {
        counts.results.forEach(r => { stockMap[r.category] = r.count; });
      }

      const stockMsg = 
        `📊 <b>လက်ရှိ Key Stock အခြေအနေ:</b>\n\n` +
        `• 🎁 Free Test Key: <b>${stockMap.test}</b> ခု\n` +
        `• 🔹 50 GB Keys: <b>${stockMap["50gb"]}</b> ခု\n` +
        `• 🔹 100 GB Keys: <b>${stockMap["100gb"]}</b> ခု\n` +
        `• 🔹 250 GB Keys: <b>${stockMap["250gb"]}</b> ခု\n`;

      await tg(env, "sendMessage", { chat_id: chatId, text: stockMsg, parse_mode: "HTML" });
      return;
    }

    const validCommands = ["/add_test", "/add_50gb", "/add_100gb", "/add_250gb"];
    if (validCommands.includes(cleanCmd)) {
      const category = cleanCmd.replace("/add_", "");
      const lines = text.split("\n").slice(1);
      const validKeys = lines.map(k => k.trim()).filter(k => k.startsWith("ss://"));

      if (validKeys.length === 0) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ Key များ မတွေ့ပါ။ ပုံစံ:\n<code>${cleanCmd}</code>\nss://key1...\nss://key2...`,
          parse_mode: "HTML",
        });
        return;
      }

      // Batch insert keys
      const stmts = validKeys.map(k => 
        env.DB.prepare("INSERT OR IGNORE INTO keys (category, access_key) VALUES (?, ?)").bind(category, k)
      );
      await env.DB.batch(stmts);

      // Stock အရေအတွက် ပြန်ဆွဲထုတ်ပြသခြင်း
      const currentStock = await env.DB.prepare("SELECT COUNT(*) as count FROM keys WHERE category = ?").bind(category).first();

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `✅ <b>Category [${category.toUpperCase()}] သို့ Key များ ထည့်သွင်းပြီးပါပြီ!</b>\n\n• အသစ်ထည့်သွင်း: <b>${validKeys.length}</b> ခု\n• လက်ကျန်စုစုပေါင်း: <b>${currentStock?.count || validKeys.length}</b> ခု`,
        parse_mode: "HTML"
      });
      return;
    }
  }
}

// Inline Callback Query Handler
async function handleCallback(cb, env) {
  const userId = cb.from.id;
  const callbackId = cb.id;
  const chatId = String(cb.message.chat.id);
  const messageId = cb.message.message_id;
  const data = cb.data;
  const paymentGroupId = String(env.PAYMENT_GROUP_ID || "").trim();

  // Telegram Loading ချက်ချင်းပိတ်ခြင်း
  await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });

  async function editMsg(text, replyMarkup) {
    await tg(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }

  // --- A. PAYMENT GROUP ACTIONS ---
  if (paymentGroupId && chatId === paymentGroupId) {
    if (data.startsWith("pay_app_")) {
      const parts = data.split("_");
      const reqId = parts[2];
      const targetUserId = parts[3];
      const amount = Number(parts[4]);

      await env.DB.batch([
        env.DB.prepare("UPDATE users SET balance = balance + ? WHERE telegram_id = ?").bind(amount, targetUserId),
        env.DB.prepare("UPDATE topup_requests SET status = 'approved' WHERE id = ?").bind(reqId)
      ]);

      await tg(env, "editMessageCaption", {
        chat_id: chatId,
        message_id: messageId,
        caption: (cb.message.caption || "") + `\n\n🟢 <b>APPROVED (+${amount.toLocaleString()} Ks) by Admin</b>`,
        parse_mode: "HTML"
      });

      await tg(env, "sendMessage", {
        chat_id: targetUserId,
        text: `🎉 <b>ငွေဖြည့်သွင်းမှု အောင်မြင်ပါပြီ!</b>\n\nသင့် Wallet ထဲသို့ <b>+${amount.toLocaleString()} Ks</b> ထည့်သွင်းပေးလိုက်ပါပြီ။\nယခုအခါ VPN Key များကို အချိန်မရွေး စိတ်ကြိုက် ဝယ်ယူနိုင်ပါပြီ ခင်ဗျာ။`,
        parse_mode: "HTML",
        reply_markup: getMainKeyboard(),
      });
      return;
    }

    if (data.startsWith("pay_rej_")) {
      const parts = data.split("_");
      const reqId = parts[2];
      const targetUserId = parts[3];

      await env.DB.prepare("UPDATE topup_requests SET status = 'rejected' WHERE id = ?").bind(reqId).run();

      await tg(env, "editMessageCaption", {
        chat_id: chatId,
        message_id: messageId,
        caption: (cb.message.caption || "") + `\n\n🔴 <b>REJECTED by Admin</b>`,
        parse_mode: "HTML"
      });

      await tg(env, "sendMessage", {
        chat_id: targetUserId,
        text: "❌ <b>သင့် ငွေလွှဲပြေစာ အတည်မပြုနိုင်ပါခင်ဗျာ။</b>\nငွေလွှဲမှတ်တမ်း မှန်ကန်ပါက Support သို့ ဆက်သွယ်ပေးပါ။",
        parse_mode: "HTML",
        reply_markup: getMainKeyboard(),
      });
      return;
    }

    if (data.startsWith("pay_ban_")) {
      const targetUserId = data.replace("pay_ban_", "");
      await env.DB.prepare("UPDATE users SET is_banned = 1 WHERE telegram_id = ?").bind(targetUserId).run();

      await tg(env, "editMessageCaption", {
        chat_id: chatId,
        message_id: messageId,
        caption: (cb.message.caption || "") + `\n\n🚫 <b>USER BANNED (Fake Slip)</b>`,
        parse_mode: "HTML"
      });

      await tg(env, "sendMessage", {
        chat_id: targetUserId,
        text: "🚫 <b>သင်သည် ပြေစာအတု ပေးပို့မှုကြောင့် Bot မှ အပြီးအပိုင် Ban ခံလိုက်ရပါပြီ။</b>",
        parse_mode: "HTML"
      });
      return;
    }
  }

  // --- B. USER SIDE NAVIGATION ---
  const user = await getOrCreateUser(env, cb.from);
  if (user.is_banned === 1) {
    await editMsg("🚫 <b>သင့်အကောင့်သည် Ban ခံထားရပါသဖြင့် ဆက်လက် အသုံးမပြုနိုင်ပါ။</b>", { inline_keyboard: [] });
    return;
  }

  const balance = Number(user.balance || 0);

  // Home Menu
  if (data === "menu_home") {
    await env.DB.prepare("UPDATE users SET pending_topup_amount = 0 WHERE telegram_id = ?").bind(user.telegram_id).run();
    const welcomeText = 
      `👋 မင်္ဂလာပါ <b>${cb.from.first_name || ""}</b>! ✨\n\n` +
      `Outline VPN Automated Store မှ ကြိုဆိုပါသည်။\n` +
      `မိမိ လိုအပ်သော ဝန်ဆောင်မှုကို အောက်ပါ Menu မှ ရွေးချယ်နိုင်ပါသည် 👇`;
    await editMsg(welcomeText, getMainKeyboard());
    return;
  }

  // Balance
  if (data === "menu_balance") {
    const balMsg = 
      `💵 <b>သင့် Wallet အခြေအနေ:</b>\n\n` +
      `👤 အမည်: <b>${cb.from.first_name || ""}</b>\n` +
      `🆔 Telegram ID: <code>${user.telegram_id}</code>\n` +
      `💰 လက်ကျန်ငွေ: <b>${balance.toLocaleString()} Ks</b>\n\n` +
      `<i>ငွေဖြည့်သွင်းလိုပါက အောက်ပါ Top Up ခလုတ်ကို နှိပ်ပါ 👇</i>`;
    await editMsg(balMsg, {
      inline_keyboard: [
        [{ text: "💳 Top Up ငွေဖြည့်မည်", callback_data: "menu_topup" }],
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
      ]
    });
    return;
  }

  // Profile
  if (data === "menu_profile") {
    const regDate = user.created_at ? formatMyanmarTime(new Date(user.created_at.replace(" ", "T") + "Z")) : "N/A";
    const profMsg = 
      `👤 <b>User Profile အချက်အလက်</b>\n\n` +
      `🆔 Telegram ID: <code>${user.telegram_id}</code>\n` +
      `👤 နာမည်: <b>${cb.from.first_name || ""}</b>\n` +
      `💰 Balance: <b>${balance.toLocaleString()} Ks</b>\n` +
      `📦 ဝယ်ယူပြီး အော်ဒါ: <b>${user.total_orders || 0} ခု</b>\n` +
      `📅 စတင်အသုံးပြုသည့်နေ့: <b>${regDate}</b>`;
    await editMsg(profMsg, {
      inline_keyboard: [
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
      ]
    });
    return;
  }

  // Terms
  if (data === "menu_terms") {
    const termsMsg = 
      `📜 <b>စည်းကမ်းချက်များနှင့် အသုံးပြုပုံ မူဝါဒ:</b>\n\n` +
      `1. ငွေလွှဲသည့်အခါ မှတ်ချက် (Note) တွင် VPN / Key / Outline စာသားများ လုံးဝ မရေးရပါ။\n` +
      `2. ဝယ်ယူရရှိသော Key အား တစ်ဦးတည်းသာ သီးသန့် အသုံးပြုရပါမည်။\n` +
      `3. ငွေလွှဲပြေစာအတု ပို့ဆောင်ပါက User ID အား အမေးအမြန်း မရှိ အပြီးအပိုင် Ban ပါမည်။\n` +
      `4. Server ပြဿနာတစ်စုံတစ်ရာ ရှိပါက Support သို့ ဆက်သွယ်နိုင်ပါသည်။`;
    await editMsg(termsMsg, {
      inline_keyboard: [
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
      ]
    });
    return;
  }

  // Topup ပမာဏ ရွေးချယ်မှု
  if (data === "menu_topup") {
    const topupSelectMsg = 
      `💳 <b>ငွေဖြည့်သွင်းမည့် ပမာဏ ရွေးချယ်ပါ</b>\n\n` +
      `မိမိ Wallet ထဲသို့ ဖြည့်သွင်းလိုသော ပမာဏကို အောက်ပါ ခလုတ်များမှ ရွေးချယ်ပေးပါ (သို့မဟုတ်) မိမိစိတ်ကြိုက် ပမာဏကိုလည်း ရိုက်ထည့်နိုင်ပါသည် 👇`;
    await editMsg(topupSelectMsg, {
      inline_keyboard: [
        [{ text: "💵 2,500 Ks (50GB စာ)", callback_data: "topup_amt_2500" }],
        [{ text: "💵 4,500 Ks (100GB စာ)", callback_data: "topup_amt_4500" }],
        [{ text: "💵 10,500 Ks (250GB စာ)", callback_data: "topup_amt_10500" }],
        [{ text: "✍️ စိတ်ကြိုက် ပမာဏ ရိုက်ထည့်မည်", callback_data: "topup_custom" }],
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
      ]
    });
    return;
  }

  // စိတ်ကြိုက် Amount Prompt (အနည်းဆုံး 2,500 Ks)
  if (data === "topup_custom") {
    await env.DB.prepare("UPDATE users SET pending_topup_amount = -1 WHERE telegram_id = ?").bind(userId).run();

    const customPromptMsg = 
      `✍️ <b>စိတ်ကြိုက် ပမာဏ ရိုက်ထည့်ခြင်း</b>\n\n` +
      `မိမိ Wallet ထဲသို့ ဖြည့်သွင်းလိုသော ပမာဏကို <b>ကိန်းဂဏန်းသီးသန့်</b> ဤ Chat ထဲသို့ စာရိုက်၍ ပေးပို့ပေးပါခင်ဗျာ။\n\n` +
      `• အနည်းဆုံး ပမာဏ: <b>2,500 Ks</b>\n` +
      `• ဥပမာ ပုံစံ: <code>2500</code>, <code>5000</code> သို့မဟုတ် <code>20000</code>`;

    await editMsg(customPromptMsg, {
      inline_keyboard: [
        [{ text: "🔙 နောက်သို့ ပြန်သွားမည်", callback_data: "menu_topup" }]
      ]
    });
    return;
  }

  // Standard Topup Amount ရွေးပြီးချိန် Payment Info
  if (data.startsWith("topup_amt_")) {
    const amount = Number(data.replace("topup_amt_", ""));
    await env.DB.prepare("UPDATE users SET pending_topup_amount = ? WHERE telegram_id = ?").bind(amount, userId).run();

    const payInfoMsg = 
      `💳 <b>ငွေလွှဲရန် အချက်အလက်များ</b>\n\n` +
      `💰 လွှဲရမည့် ပမာဏ: <b>${amount.toLocaleString()} Ks</b>\n\n` +
      `📱 <b>KBZPay:</b> <code>09456545321</code> (Gum Seng Lat)\n` +
      `📱 <b>AYAPay:</b> <code>09456545321</code> (Gum Seng Lat)\n` +
      `<i>(ဖုန်းနံပါတ်ကို tap နှိပ်၍ အလွယ်တကူ Copy ယူနိုင်ပါသည်)</i>\n\n` +
      `⚠️ <b>အရေးကြီးသော စည်းကမ်းချက်များ:</b>\n` +
      `• ငွေလွှဲမှတ်ချက် (Note) တွင် VPN / Outline စာသားများ <b>လုံးဝ မရေးပါနှင့်</b>။\n` +
      `• အထက်ဖော်ပြပါ ပမာဏအတိုင်း အတိအကျ လွှဲပေးပါ။\n` +
      `• ငွေလွှဲပြီးပါက ပြေစာ <b>Screenshot (ဓာတ်ပုံ)</b> ကို ဤ Chat ထဲသို့ ပို့ပေးပါ။\n` +
      `• ပြေစာအတု ပို့ဆောင်ပါက Bot အား အမေးအမြန်း မရှိ အပြီးအပိုင် <b>Ban</b> ပါမည်။\n\n` +
      `👉 <i>ယခု ငွေလွှဲပြေစာ ဓာတ်ပုံကို ပေးပို့နိုင်ပါပြီ-</i>`;

    await editMsg(payInfoMsg, {
      inline_keyboard: [
        [{ text: "🔙 ပမာဏ ပြန်ရွေးမည်", callback_data: "menu_topup" }]
      ]
    });
    return;
  }

  // Buy Outline Key: Packages List
  if (data === "menu_buy") {
    const buyMenuText = 
      `🛍 <b>Outline VPN Package များ ရွေးချယ်ပါ</b>\n\n` +
      `လက်ရှိ Wallet Balance: <b>${balance.toLocaleString()} Ks</b>\n\n` +
      `🔹 <b>50 GB Plan (၃၀ ရက်)</b> - 2,500 Ks\n` +
      `🔹 <b>100 GB Plan (၃၅ ရက်)</b> - 4,500 Ks\n` +
      `🔹 <b>250 GB Plan (၇၅ ရက်)</b> - 10,500 Ks\n\n` +
      `ဝယ်ယူလိုသော Package ကို ရွေးချယ်ပါ 👇`;

    await editMsg(buyMenuText, {
      inline_keyboard: [
        [{ text: "🛒 ဝယ်မည်: 50 GB (2,500 Ks)", callback_data: "buy_pkg_50gb_2500" }],
        [{ text: "🛒 ဝယ်မည်: 100 GB (4,500 Ks)", callback_data: "buy_pkg_100gb_4500" }],
        [{ text: "🛒 ဝယ်မည်: 250 GB (10,500 Ks)", callback_data: "buy_pkg_250gb_10500" }],
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
      ]
    });
    return;
  }

  // Buy Outline Key: Process
  if (data.startsWith("buy_pkg_")) {
    const parts = data.split("_");
    const category = parts[2];
    const price = Number(parts[3]);

    if (balance < price) {
      await editMsg(
        `⚠️ <b>လက်ကျန်ငွေ မလုံလောက်ပါ!</b>\n\n` +
        `ကျသင့်ငွေ: <b>${price.toLocaleString()} Ks</b>\n` +
        `သင့်လက်ကျန်ငွေ: <b>${balance.toLocaleString()} Ks</b>\n\n` +
        `ကျေးဇူးပြု၍ Wallet ထဲသို့ ငွေဖြည့်သွင်းပြီးမှ ပြန်လည်ဝယ်ယူပေးပါခင်ဗျာ။`,
        {
          inline_keyboard: [
            [{ text: "💳 Top Up ငွေဖြည့်မည်", callback_data: "menu_topup" }],
            [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
          ]
        }
      );
      return;
    }

    const keyItem = await env.DB.prepare(
      "SELECT id, access_key FROM keys WHERE category = ? LIMIT 1"
    ).bind(category).first();

    if (!keyItem) {
      await editMsg(
        `😔 <b>စိတ်မကောင်းပါခင်ဗျာ!</b>\n\n` +
        `လက်ရှိတွင် <b>[${category.toUpperCase()}]</b> Key များ Stock ပြတ်လပ်နေပါသည်။\n` +
        `Admin Team ဘက်မှ Stock ဖြည့်တင်းချိန်ကို စောင့်ဆိုင်းပေးပါခင်ဗျာ။`,
        {
          inline_keyboard: [
            [{ text: "🔙 ပြန်သွားမည်", callback_data: "menu_buy" }],
            [{ text: "💬 Contact Admin", url: "https://t.me/JaiwaJG" }]
          ]
        }
      );
      return;
    }

    await env.DB.batch([
      env.DB.prepare("UPDATE users SET balance = balance - ?, total_orders = total_orders + 1 WHERE telegram_id = ?").bind(price, userId),
      env.DB.prepare("DELETE FROM keys WHERE id = ?").bind(keyItem.id),
      env.DB.prepare("INSERT INTO orders (user_id, category, access_key, price) VALUES (?, ?, ?, ?)").bind(userId, category, keyItem.access_key, price)
    ]);

    const deliveryMsg = 
      `🎉 <b>ဝယ်ယူမှု အောင်မြင်ပါပြီ!</b>\n\n` +
      `📦 Package: <b>${category.toUpperCase()}</b>\n` +
      `💰 ကျသင့်ငွေ: <b>${price.toLocaleString()} Ks</b>\n\n` +
      `🔑 <b>သင်၏ Outline Key:</b>\n` +
      `<code>${keyItem.access_key}</code>\n\n` +
      `👆 <i>Key ကို ဖိနှိပ် (Tap) ၍ Copy ယူနိုင်ပါသည်။</i>`;

    await editMsg(deliveryMsg, {
      inline_keyboard: [
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }],
        [{ text: "💬 Contact Admin", url: "https://t.me/JaiwaJG" }]
      ]
    });
    return;
  }

  // --- C. FREE TEST KEY HANDLING (ပြန်ကြည့်ရန် ခလုတ်ပါဝင်သည်) ---
  if (data === "menu_test_key") {
    if (user.last_claimed_test_at && user.current_test_key) {
      const lastClaim = new Date(user.last_claimed_test_at.replace(" ", "T") + "Z");
      const nextDate = new Date(lastClaim.getTime() + 30 * 24 * 60 * 60 * 1000);
      const now = new Date();

      if (now < nextDate) {
        const remainingMs = nextDate - now;
        const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        await editMsg(
          `⚠️ <b>သင်သည် Test Key ရယူပြီးသား ဖြစ်ပါသည်!</b>\n\n` +
          `📅 ရယူခဲ့သည့်နေ့: ${formatMyanmarTime(lastClaim)}\n` +
          `⏳ နောက်တစ်ကြိမ် ယူနိုင်မည့်နေ့: ${formatMyanmarTime(nextDate)}\n\n` +
          `<i>နောက်ထပ် Key အသစ် ရယူရန် <b>${days} ရက်နှင့် ${hours} နာရီ</b> လိုပါသေးသည်။</i>\n\n` +
          `ယခင်ရယူထားသော Test Key ကို ပြန်လည်ကြည့်ရှုလိုပါက အောက်ပါခလုတ်ကို နှိပ်ပါ 👇`,
          {
            inline_keyboard: [
              [{ text: "🔑 ကျွန်ုပ်၏ Test Key ပြန်ကြည့်မည်", callback_data: "view_claimed_test_key" }],
              [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
            ]
          }
        );
        return;
      }
    }

    // Stock မှ Key ဆွဲထုတ်ခြင်း
    const testKeyItem = await env.DB.prepare(
      "SELECT id, access_key FROM keys WHERE category = 'test' LIMIT 1"
    ).first();

    if (!testKeyItem) {
      await editMsg(
        "😔 လက်ရှိတွင် Free Test Key များ Stock ပြတ်လပ်နေပါသည်ခင်ဗျာ။",
        {
          inline_keyboard: [
            [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }],
            [{ text: "💬 Contact Admin", url: "https://t.me/JaiwaJG" }]
          ]
        }
      );
      return;
    }

    await env.DB.batch([
      env.DB.prepare("UPDATE users SET last_claimed_test_at = CURRENT_TIMESTAMP, current_test_key = ? WHERE telegram_id = ?").bind(testKeyItem.access_key, userId),
      env.DB.prepare("DELETE FROM keys WHERE id = ?").bind(testKeyItem.id)
    ]);

    await editMsg(
      `🎉 <b>သင်၏ Outline Free Test Key ရရှိပါပြီ!</b>\n\n` +
      `<code>${testKeyItem.access_key}</code>\n\n` +
      `👆 <i>Key ကို ဖိနှိပ် (Tap) ၍ Copy ယူနိုင်ပါသည်။</i>`,
      {
        inline_keyboard: [
          [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
        ]
      }
    );
    return;
  }

  // ရယူပြီးသား Test Key ကို ပြန်လည်ပြသပေးခြင်း
  if (data === "view_claimed_test_key") {
    const keyStr = user.current_test_key || "Key ရှာမတွေ့ပါ။";
    await editMsg(
      `🔑 <b>သင် ရယူထားသော Outline Test Key ဖြစ်ပါသည်:</b>\n\n` +
      `<code>${keyStr}</code>\n\n` +
      `👆 <i>Key ကို ဖိနှိပ် (Tap) ၍ Copy ယူနိုင်ပါသည်။</i>`,
      {
        inline_keyboard: [
          [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
        ]
      }
    );
    return;
  }
}
