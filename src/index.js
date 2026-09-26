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

// Package Configurations
const PACKAGES = {
  "50gb": { name: "50 GB Package", price: 2500, days: 30, gb: "50 GB" },
  "100gb": { name: "100 GB Package", price: 4500, days: 35, gb: "100 GB" },
  "250gb": { name: "250 GB Package", price: 10500, days: 75, gb: "250 GB" },
};

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
        { text: "👤 Profile", callback_data: "menu_profile_p_1" },
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

    if (user.is_banned === 1) {
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: "🚫 မင်္ဂလာပါခင်ဗျာ၊ စည်းကမ်းဖောက်ဖျက်မှု (ငွေလွှဲပြေစာအတု ပေးပို့မှု) တွေ့ရှိရသည့်အတွက် သင့်အကောင့်အား Bot အသုံးပြုခွင့် ရပ်ဆိုင်းထားပါသည်ခင်ဗျာ။",
        parse_mode: "HTML",
      });
      return;
    }

    if (text === "/start") {
      await env.DB.prepare("UPDATE users SET pending_topup_amount = 0 WHERE telegram_id = ?").bind(user.telegram_id).run();

      const welcomeText = 
        `👋 မင်္ဂလာပါ <b>${msg.from.first_name || "မိတ်ဆွေ"}</b> ရေ... ✨\n\n` +
        `ကျွန်တော်တို့ရဲ့ <b>Outline VPN Store</b> ကနေ နွေးထွေးစွာ ကြိုဆိုပါတယ်ခင်ဗျာ။\n` +
        `အင်တာနက်လိုင်း ကောင်းမွန်မြန်ဆန်တဲ့ VPN Key များကို အချိန်မရွေး လွယ်လွယ်ကူကူ ရယူနိုင်ပါပြီ။\n\n` +
        `အောက်က Menu လေးထဲကနေ မိမိ လိုအပ်တာကို ရွေးချယ်ပေးပါနော် 👇`;

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: welcomeText,
        parse_mode: "HTML",
        reply_markup: getMainKeyboard(),
      });
      return;
    }

    // စိတ်ကြိုက် Amount စာရိုက်ထည့်ခြင်း
    if (user.pending_topup_amount === -1 && text) {
      const cleanNum = text.replace(/,/g, "").trim();
      const amount = parseInt(cleanNum, 10);

      if (isNaN(amount) || amount < 2500) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: "⚠️ ဖြည့်သွင်းငွေ ပမာဏ နည်းနေပါသေးတယ်ခင်ဗျာ။\n\nအနည်းဆုံး <b>2,500 Ks</b> မှ စတင်ဖြည့်သွင်းနိုင်တာမို့ ဂဏန်းသီးသန့်လေး (ဥပမာ - <code>2500</code> သို့မဟုတ် <code>5000</code>) သေချာ ပြန်ရိုက်ပေးပါခင်ဗျာ။",
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
        `💳 <b>ငွေလွှဲပေးရမည့် အချက်အလက်များ</b>\n` +
        `<b>━━━━━━━━━━━━━━</b>\n\n` +
        `💰 ဖြည့်သွင်းမည့် ပမာဏ: <b>${amount.toLocaleString()} Ks</b>\n\n` +
        `အောက်ပါ အကောင့်တစ်ခုခုသို့ လွှဲပေးပါခင်ဗျာ-\n` +
        `📱 <b>KBZPay:</b> <code>09456545321</code> (Gum Seng Lat)\n` +
        `📱 <b>AYAPay:</b> <code>09456545321</code> (Gum Seng Lat)\n` +
        `<i>(ဖုန်းနံပါတ်ကို ထိလိုက်ရုံနဲ့ အလွယ်တကူ Copy ယူနိုင်ပါတယ်)</i>\n\n` +
        `⚠️ <b>မေတ္တာရပ်ခံချက်:</b>\n` +
        `• ငွေလွှဲတဲ့အခါ Note (မှတ်ချက်) ထဲမှာ VPN / Outline စတဲ့ စာလုံးတွေ လုံးဝ မရေးပေးပါနဲ့နော်။\n` +
        `• ငွေလွှဲပြီးတာနဲ့ ပြေစာ <b>Screenshot (ဓာတ်ပုံ)</b> လေးကို ဒီ Chat ထဲသို့ ပို့ပေးပါခင်ဗျာ။\n\n` +
        `👉 <i>အခု ပြေစာပုံ ပို့ပေးနိုင်ပါပြီခင်ဗျာ-</i>`;

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
          text: "⚠️ စလစ်ပုံ မပို့ခင် Menu ထဲက <b>💳 Top Up</b> ခလုတ်ကို နှိပ်ပြီး ငွေပမာဏ အရင်ရွေးပေးပါခင်ဗျာ။",
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
        text: `⏳ <b>ငွေလွှဲပြေစာ ရရှိပါပြီခင်ဗျာ!</b>\n\nဖြည့်သွင်းငွေ: <b>${currentAmt.toLocaleString()} Ks</b>\nAdmin က စစ်ဆေးအတည်ပြုပေးပြီးတာနဲ့ သင့် Wallet ထဲ ငွေချက်ချင်း ရောက်လာပါမယ်နော်။ ခဏလေး စောင့်ပေးပါခင်ဗျာ။`,
        parse_mode: "HTML",
      });

      if (paymentGroupId) {
        const captionText = 
          `📩 <b>ငွေဖြည့်တောင်းဆိုမှု အသစ် (#ID_${requestId})</b>\n\n` +
          `• <b>User:</b> ${msg.from.first_name || ""} (<code>${user.telegram_id}</code>)\n` +
          `• <b>Username:</b> @${msg.from.username || "None"}\n` +
          `• <b>ဖြည့်သွင်းမည့် ပမာဏ:</b> <b>${currentAmt.toLocaleString()} Ks</b>\n` +
          `• <b>အချိန်:</b> ${formatMyanmarTime(new Date())}\n\n` +
          `👇 <i>ငွေဝင်ရောက်မှု စစ်ပြီးပါက ရွေးချယ်ပါ:</i>`;

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

  // --- ၂။ PAYMENT GROUP COMMANDS ---
  if (paymentGroupId && chatId === paymentGroupId) {
    if (text.startsWith("/ban")) {
      const parts = text.split(" ");
      const targetId = parts[1]?.trim();
      if (targetId) {
        await env.DB.prepare("UPDATE users SET is_banned = 1 WHERE telegram_id = ?").bind(targetId).run();
        await tg(env, "sendMessage", { chat_id: chatId, text: `🚫 User <code>${targetId}</code> အား Ban လိုက်ပါပြီ။`, parse_mode: "HTML" });
      }
      return;
    }
    if (text.startsWith("/unban")) {
      const parts = text.split(" ");
      const targetId = parts[1]?.trim();
      if (targetId) {
        await env.DB.prepare("UPDATE users SET is_banned = 0 WHERE telegram_id = ?").bind(targetId).run();
        await tg(env, "sendMessage", { chat_id: chatId, text: `✅ User <code>${targetId}</code> အား Unban လိုက်ပါပြီ။`, parse_mode: "HTML" });
      }
      return;
    }
  }

  // --- ၃။ STOCK GROUP COMMANDS ---
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

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: stockMsg,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Refresh Stock", callback_data: "admin_refresh_stock" }]
          ]
        }
      });
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
          text: `⚠️ Key တွေ မတွေ့ရပါခင်ဗျာ။ ပုံစံ:\n<code>${cleanCmd}</code>\nss://key1...\nss://key2...`,
          parse_mode: "HTML",
        });
        return;
      }

      const stmts = validKeys.map(k => 
        env.DB.prepare("INSERT OR IGNORE INTO keys (category, access_key) VALUES (?, ?)").bind(category, k)
      );
      await env.DB.batch(stmts);

      const currentStock = await env.DB.prepare("SELECT COUNT(*) as count FROM keys WHERE category = ?").bind(category).first();

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `✅ <b>Category [${category.toUpperCase()}] သို့ Key များ အောင်မြင်စွာ ထည့်သွင်းပြီးပါပြီ!</b>\n\n• အသစ်ထည့်ဝင်: <b>${validKeys.length}</b> ခု\n• လက်ကျန်စုစုပေါင်း: <b>${currentStock?.count || validKeys.length}</b> ခု`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Refresh Stock", callback_data: "admin_refresh_stock" }]
          ]
        }
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
  const stockGroupId = String(env.STOCK_GROUP_ID || "").trim();

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

  // --- A. STOCK GROUP: REFRESH STOCK ---
  if (stockGroupId && chatId === stockGroupId && data === "admin_refresh_stock") {
    const counts = await env.DB.prepare("SELECT category, COUNT(*) as count FROM keys GROUP BY category").all();
    let stockMap = { test: 0, "50gb": 0, "100gb": 0, "250gb": 0 };
    if (counts.results) {
      counts.results.forEach(r => { stockMap[r.category] = r.count; });
    }
    const stockMsg = 
      `📊 <b>လက်ရှိ Key Stock အခြေအနေ (Refreshed):</b>\n\n` +
      `• 🎁 Free Test Key: <b>${stockMap.test}</b> ခု\n` +
      `• 🔹 50 GB Keys: <b>${stockMap["50gb"]}</b> ခု\n` +
      `• 🔹 100 GB Keys: <b>${stockMap["100gb"]}</b> ခု\n` +
      `• 🔹 250 GB Keys: <b>${stockMap["250gb"]}</b> ခု\n\n` +
      `<i>နောက်ဆုံးစစ်ဆေးချိန်: ${formatMyanmarTime(new Date())}</i>`;

    await editMsg(stockMsg, {
      inline_keyboard: [
        [{ text: "🔄 Refresh Stock", callback_data: "admin_refresh_stock" }]
      ]
    });
    return;
  }

  // --- B. PAYMENT GROUP ACTIONS ---
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
        text: `🎉 <b>ငွေဖြည့်သွင်းမှု အောင်မြင်ပါပြီခင်ဗျာ!</b>\n\nသင့် Wallet ထဲသို့ <b>+${amount.toLocaleString()} Ks</b> ထည့်သွင်းပေးလိုက်ပါပြီ။\nအခုပဲ Outline Key များကို စိတ်ကြိုက် ဝယ်ယူအသုံးပြုနိုင်ပါပြီခင်ဗျာ။ ✨`,
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
        text: "❌ <b>စိတ်မကောင်းပါခင်ဗျာ၊ သင့်ငွေလွှဲပြေစာ အတည်မပြုနိုင်ခဲ့ပါ။</b>\nအချက်အလက် မှားယွင်းမှုရှိပါက Support သို့ ဆက်သွယ်မေးမြန်းနိုင်ပါတယ်ခင်ဗျာ။",
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
        text: "🚫 စည်းကမ်းဖောက်ဖျက်မှု (ငွေလွှဲပြေစာအတု ပေးပို့မှု) ကြောင့် သင့်အကောင့်အား Bot အသုံးပြုခွင့် ရပ်ဆိုင်းလိုက်ပါပြီခင်ဗျာ။",
        parse_mode: "HTML"
      });
      return;
    }
  }

  // --- C. USER SIDE ACTIONS ---
  const user = await getOrCreateUser(env, cb.from);
  if (user.is_banned === 1) {
    await editMsg("🚫 သင့်အကောင့်အား Bot အသုံးပြုခွင့် ရပ်ဆိုင်းထားပါသည်ခင်ဗျာ။", { inline_keyboard: [] });
    return;
  }

  const balance = Number(user.balance || 0);

  // Home Menu
  if (data === "menu_home") {
    await env.DB.prepare("UPDATE users SET pending_topup_amount = 0 WHERE telegram_id = ?").bind(user.telegram_id).run();
    const welcomeText = 
      `👋 မင်္ဂလာပါ <b>${cb.from.first_name || "မိတ်ဆွေ"}</b> ရေ... ✨\n\n` +
      `ကျွန်တော်တို့ရဲ့ <b>Outline VPN Store</b> မှ ကြိုဆိုပါတယ်ခင်ဗျာ။\n` +
      `အောက်ပါ Menu လေးထဲကနေ မိမိ လိုအပ်တာကို ရွေးချယ်နိုင်ပါတယ်နော် 👇`;
    await editMsg(welcomeText, getMainKeyboard());
    return;
  }

  // Balance
  if (data === "menu_balance") {
    const balMsg = 
      `💵 <b>သင့် လက်ကျန်ငွေ အခြေအနေ</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n\n` +
      `👤 အသုံးပြုသူ: <b>${cb.from.first_name || ""}</b>\n` +
      `🆔 Telegram ID: <code>${user.telegram_id}</code>\n` +
      `💰 လက်ရှိ Balance: <b>${balance.toLocaleString()} Ks</b>\n\n` +
      `<i>ငွေဖြည့်သွင်းလိုပါက အောက်ပါ Top Up ခလုတ်လေးကို နှိပ်ပေးပါခင်ဗျာ 👇</i>`;
    await editMsg(balMsg, {
      inline_keyboard: [
        [{ text: "💳 Top Up ငွေဖြည့်မည်", callback_data: "menu_topup" }],
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
      ]
    });
    return;
  }

  // Profile: ဝယ်ထားသော Key များ 2 Columns x 5 Rows (10 Items Per Page) စီ ပြသခြင်း
  if (data.startsWith("menu_profile_p_")) {
    const page = parseInt(data.replace("menu_profile_p_", ""), 10) || 1;
    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    const totalOrdersRes = await env.DB.prepare("SELECT COUNT(*) as count FROM orders WHERE user_id = ?").bind(userId).first();
    const totalOrders = totalOrdersRes?.count || 0;
    const totalPages = Math.ceil(totalOrders / pageSize) || 1;

    const ordersRes = await env.DB.prepare(
      "SELECT id, category, price, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?"
    ).bind(userId, pageSize, offset).all();

    const orders = ordersRes.results || [];

    const regDate = user.created_at ? formatMyanmarTime(new Date(user.created_at.replace(" ", "T") + "Z")) : "N/A";
    let profMsg = 
      `👤 <b>သင့် Profile အချက်အလက်များ</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n\n` +
      `• 🆔 Telegram ID: <code>${user.telegram_id}</code>\n` +
      `• 👤 အမည်: <b>${cb.from.first_name || ""}</b>\n` +
      `• 💰 Wallet Balance: <b>${balance.toLocaleString()} Ks</b>\n` +
      `• 📦 ဝယ်ယူထားသည့် Key စုစုပေါင်း: <b>${totalOrders} ခု</b>\n` +
      `• 📅 စတင်သုံးစွဲသည့်ရက်: <b>${regDate}</b>\n\n` +
      `🔑 <b>သင် ဝယ်ယူထားသော Key များ:</b>\n`;

    if (orders.length === 0) {
      profMsg += `<i>(လက်ရှိတွင် ဝယ်ယူထားသော Key မရှိသေးပါခင်ဗျာ)</i>`;
    } else {
      profMsg += `<i>အသေးစိတ်နှင့် Key ပြန်ကြည့်ရန် သက်ဆိုင်ရာ Key ခလုတ်လေးကို နှိပ်ပါ-</i>`;
    }

    // 2 Columns x 5 Rows Layout
    let inlineKeyboard = [];
    let row = [];
    orders.forEach((o, index) => {
      row.push({
        text: `🔑 #${o.id} (${o.category.toUpperCase()})`,
        callback_data: `view_ord_${o.id}_${page}`
      });
      if (row.length === 2) {
        inlineKeyboard.push(row);
        row = [];
      }
    });
    if (row.length > 0) {
      inlineKeyboard.push(row);
    }

    // Pagination Row
    let navRow = [];
    if (page > 1) {
      navRow.push({ text: "◀️ ရှေ့သို့", callback_data: `menu_profile_p_${page - 1}` });
    }
    if (totalPages > 1) {
      navRow.push({ text: `📄 ${page}/${totalPages}`, callback_data: "noop" });
    }
    if (page < totalPages) {
      navRow.push({ text: "နောက်သို့ ▶️", callback_data: `menu_profile_p_${page + 1}` });
    }
    if (navRow.length > 0) {
      inlineKeyboard.push(navRow);
    }

    inlineKeyboard.push([{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]);

    await editMsg(profMsg, { inline_keyboard: inlineKeyboard });
    return;
  }

  // Profile ထဲမှ Key တစ်ခုချင်းစီကို ပြန်ကြည့်ခြင်း (ကျန်ရှိသည့်ရက်နှင့် သက်တမ်းတွက်ချက်မှု)
  if (data.startsWith("view_ord_")) {
    const parts = data.split("_");
    const orderId = parts[2];
    const returnPage = parts[3] || 1;

    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").bind(orderId, userId).first();

    if (!order) {
      await editMsg("⚠️ Key အချက်အလက် ရှာမတွေ့ပါခင်ဗျာ။", {
        inline_keyboard: [[{ text: "🔙 ပြန်သွားမည်", callback_data: `menu_profile_p_${returnPage}` }]]
      });
      return;
    }

    const pkgInfo = PACKAGES[order.category] || { days: 30, gb: order.category };
    const buyDate = new Date(order.created_at.replace(" ", "T") + "Z");
    const expiryDate = new Date(buyDate.getTime() + pkgInfo.days * 24 * 60 * 60 * 1000);
    const now = new Date();

    let statusText = "";
    if (now > expiryDate) {
      statusText = `🔴 <b>သက်တမ်းကုန်ဆုံးသွားပါပြီ</b>`;
    } else {
      const diffMs = expiryDate - now;
      const leftDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const leftHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      statusText = `🟢 <b>အသုံးပြုနိုင်ဆဲ (ရက်ပေါင်း ${leftDays} ရက်နှင့် ${leftHours} နာရီ ကျန်ရှိ)</b>`;
    }

    const detailMsg = 
      `📦 <b>ဝယ်ယူထားသော Key အချက်အလက် (#${order.id})</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n\n` +
      `• 💎 <b>Package:</b> ${pkgInfo.gb || order.category.toUpperCase()}\n` +
      `• 💰 <b>ဝယ်ယူခဲ့သည့် ဈေးနှုန်း:</b> ${order.price.toLocaleString()} Ks\n` +
      `• 📅 <b>ဝယ်ယူခဲ့သည့် အချိန်:</b> ${formatMyanmarTime(buyDate)}\n` +
      `• ⏳ <b>သက်တမ်း ကုန်ဆုံးမည့်ရက်:</b> ${formatMyanmarTime(expiryDate)}\n` +
      `• 📊 <b>အခြေအနေ:</b> ${statusText}\n\n` +
      `🔑 <b>သင်၏ Outline Key:</b>\n` +
      `<code>${order.access_key}</code>\n\n` +
      `👆 <i>Key စာသားကို ဖိနှိပ် (Tap) ၍ Copy ယူနိုင်ပါတယ်ခင်ဗျာ။</i>`;

    await editMsg(detailMsg, {
      inline_keyboard: [
        [{ text: "🔙 စာရင်းသို့ ပြန်သွားမည်", callback_data: `menu_profile_p_${returnPage}` }],
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
      ]
    });
    return;
  }

  // Terms
  if (data === "menu_terms") {
    const termsMsg = 
      `📜 <b>ဝန်ဆောင်မှု စည်းကမ်းချက်များ</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n\n` +
      `၁။ ငွေလွှဲပေးပို့ရာတွင် Note (မှတ်ချက်) နေရာ၌ VPN / Key / Outline စသည့် စာလုံးများ လုံးဝ (လုံးဝ) မရေးရပါ။\n` +
      `၂။ ရရှိလာသော Key သည် မိမိတစ်ဦးတည်းအတွက်သာ ဖြစ်ပြီး အခြားသူများနှင့် မျှဝေသုံးစွဲခြင်း မပြုရပါ။\n` +
      `၃။ ငွေလွှဲပြေစာအတု ပို့ဆောင်ပါက သင့်အကောင့်အား Bot အသုံးပြုခွင့် အပြီးအပိုင် ရပ်ဆိုင်း (Ban) သွားမည် ဖြစ်ပါသည်။\n` +
      `၄။ Server ပြဿနာတစ်စုံတစ်ရာ ရှိပါက Support မှတစ်ဆင့် အချိန်မရွေး လွတ်လပ်စွာ ဆက်သွယ်နိုင်ပါသည်။`;
    await editMsg(termsMsg, {
      inline_keyboard: [
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
      ]
    });
    return;
  }

  // Top Up: ပမာဏ ရွေးချယ်မှု
  if (data === "menu_topup") {
    const topupSelectMsg = 
      `💳 <b>ငွေဖြည့်သွင်းမည့် ပမာဏ ရွေးချယ်ပါ</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n\n` +
      `Wallet ထဲသို့ ဖြည့်သွင်းလိုသော ပမာဏကို အောက်ပါ ခလုတ်လေးများမှ ရွေးချယ်ပေးပါခင်ဗျာ။ စိတ်ကြိုက်ပမာဏလည်း ရိုက်ထည့်နိုင်ပါတယ်နော် 👇`;
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
      `✍️ <b>စိတ်ကြိုက် ပမာဏ ရိုက်ထည့်ခြင်း</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n\n` +
      `မိမိ ဖြည့်သွင်းလိုသော ပမာဏကို <b>ကိန်းဂဏန်းသီးသန့်</b> ဤ Chat ထဲသို့ စာရိုက်၍ ပေးပို့ပေးပါခင်ဗျာ။\n\n` +
      `• အနည်းဆုံး ပမာဏ: <b>2,500 Ks</b>\n` +
      `• ဥပမာ ပုံစံ: <code>2500</code>, <code>5000</code>, <code>20000</code>`;

    await editMsg(customPromptMsg, {
      inline_keyboard: [
        [{ text: "🔙 နောက်သို့ ပြန်သွားမည်", callback_data: "menu_topup" }]
      ]
    });
    return;
  }

  // Standard Top Up Amount ရွေးပြီးချိန် Payment Info
  if (data.startsWith("topup_amt_")) {
    const amount = Number(data.replace("topup_amt_", ""));
    await env.DB.prepare("UPDATE users SET pending_topup_amount = ? WHERE telegram_id = ?").bind(amount, userId).run();

    const payInfoMsg = 
      `💳 <b>ငွေလွှဲပေးရမည့် အချက်အလက်များ</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n\n` +
      `💰 ဖြည့်သွင်းမည့် ပမာဏ: <b>${amount.toLocaleString()} Ks</b>\n\n` +
      `အောက်ပါ အကောင့်တစ်ခုခုသို့ လွှဲပေးပါခင်ဗျာ-\n` +
      `📱 <b>KBZPay:</b> <code>09456545321</code> (Gum Seng Lat)\n` +
      `📱 <b>AYAPay:</b> <code>09456545321</code> (Gum Seng Lat)\n` +
      `<i>(ဖုန်းနံပါတ်ကို ထိလိုက်ရုံနဲ့ အလွယ်တကူ Copy ယူနိုင်ပါတယ်)</i>\n\n` +
      `⚠️ <b>မေတ္တာရပ်ခံချက်:</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n` +
      `• ငွေလွှဲတဲ့အခါ Note (မှတ်ချက်) ထဲမှာ VPN / Outline စတဲ့ စာလုံးတွေ လုံးဝ မရေးပေးပါနဲ့နော်။\n` +
      `• အထက်ဖော်ပြပါ ပမာဏအတိုင်း အတိအကျ လွှဲပေးပါ။\n` +
      `• ငွေလွှဲပြီးတာနဲ့ ပြေစာ <b>Screenshot</b> ကို ဒီ Chat ထဲသို့ ပို့ပေးပါခင်ဗျာ။\n\n` +
      `👉 <i>အခု ပြေစာပုံ ပို့ပေးနိုင်ပါပြီခင်ဗျာ-</i>`;

    await editMsg(payInfoMsg, {
      inline_keyboard: [
        [{ text: "🔙 ပမာဏ ပြန်ရွေးမည်", callback_data: "menu_topup" }]
      ]
    });
    return;
  }

  // Buy Outline Key: Packages List (ရှင်းလင်း သပ်ရပ်သော UI)
  if (data === "menu_buy") {
    const buyMenuText = 
      `⚡️ <b>Outline VPN Package စာရင်းများနှင့် ဈေးနှုန်းများ</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n` +
      `💰 သင့် လက်ရှိ Wallet Balance:<b>${balance.toLocaleString()} Ks</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n` +
      `🔹 <b>50 GB Plan (ရက် ၃၀ သက်တမ်း)</b>\n` +
      `• Data Limit: <b>50 GB</b>\n` +
      `• သက်တမ်း: <b>30 Days</b>\n` +
      `• စျေးနှုန်း: <b>2,500 Ks</b>(ဈေးချို)\n\n` +
      `🔹 <b>100 GB Plan (၃၅ ရက် သက်တမ်း)</b>\n` +
      `• Data Limit: <b>100 GB</b>\n` +
      `• သက်တမ်း: <b>35 Days</b>\n` +
      `• စျေးနှုန်း: <b>4,500 Ks</b> (သက်သာ)\n\n` +
      `🔹 <b>250 GB Plan (၇၅ ရက် သက်တမ်း)</b>\n` +
      `• Data Limit: <b>250 GB</b>\n` +
      `• သက်တမ်း: <b>75 Days</b>\n` +
      `• စျေးနှုန်း: <b>10,500 Ks</b> (လူကြိုက်များ)\n` +
      `<b>━━━━━━━━━━━━━━</b>\n\n` +
      `ဝယ်ယူလိုသော Package ကို အောက်ပါ ခလုတ်လေးမှ ရွေးချယ်နိုင်ပါတယ်ခင်ဗျာ 👇`;

    await editMsg(buyMenuText, {
      inline_keyboard: [
        [{ text: "🛒 50 GB ဝယ်ယူမည် (2,500 Ks)", callback_data: "buy_pkg_50gb_2500" }],
        [{ text: "🛒 100 GB ဝယ်ယူမည် (4,500 Ks)", callback_data: "buy_pkg_100gb_4500" }],
        [{ text: "🛒 250 GB ဝယ်ယူမည် (10,500 Ks)", callback_data: "buy_pkg_250gb_10500" }],
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
      ]
    });
    return;
  }

  // Buy Key Process (Key မထပ်စေရန်နှင့် တိကျစွာ Balance နှုတ်ယူခြင်း)
  if (data.startsWith("buy_pkg_")) {
    const parts = data.split("_");
    const category = parts[2];
    const price = Number(parts[3]);

    if (balance < price) {
      await editMsg(
        `⚠️ <b>လက်ကျန်ငွေ မလုံလောက်သေးပါခင်ဗျာ!</b>\n` +
        `<b>━━━━━━━━━━━━━━</b>\n\n` +
        `• ကျသင့်ငွေ: <b>${price.toLocaleString()} Ks</b>\n` +
        `• သင့်လက်ကျန်ငွေ: <b>${balance.toLocaleString()} Ks</b>\n\n` +
        `ကျေးဇူးပြု၍ Wallet ထဲသို့ ငွေဖြည့်သွင်းပြီးမှ ပြန်လည် ဝယ်ယူပေးပါနော်။`,
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
        `😔 <b>စိတ်မကောင်းပါခင်ဗျာ!</b>\n` +
        `<b>━━━━━━━━━━━━━━</b>\n\n` +
        `လက်ရှိတွင် <b>[${category.toUpperCase()}]</b> Key များ Stock ပြတ်လပ်နေပါသဖြင့် Admin ဘက်မှ Stock ဖြည့်တင်းချိန်ကို စောင့်ဆိုင်းပေးပါခင်ဗျာ။`,
        {
          inline_keyboard: [
            [{ text: "🔙 ပြန်သွားမည်", callback_data: "menu_buy" }],
            [{ text: "💬 Support သို့ မေးမြန်းမည်", url: "https://t.me/JaiwaJG" }]
          ]
        }
      );
      return;
    }

    // Atomic Batch: ငွေနှုတ်၊ Stock မှ ဖျက်၊ Orders မှတ်
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET balance = balance - ?, total_orders = total_orders + 1 WHERE telegram_id = ?").bind(price, userId),
      env.DB.prepare("DELETE FROM keys WHERE id = ?").bind(keyItem.id),
      env.DB.prepare("INSERT INTO orders (user_id, category, access_key, price) VALUES (?, ?, ?, ?)").bind(userId, category, keyItem.access_key, price)
    ]);

    const pkgInfo = PACKAGES[category] || { days: 30, gb: category };
    const deliveryMsg = 
      `🎉 <b>ဝယ်ယူမှု အောင်မြင်ပါပြီခင်ဗျာ!</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n\n` +
      `• 📦 <b>Package:</b> ${pkgInfo.gb} (${pkgInfo.days} ရက် သက်တမ်း)\n` +
      `• 💰 <b>ကျသင့်ငွေ:</b> ${price.toLocaleString()} Ks\n\n` +
      `🔑 <b>သင့် Outline Key:</b>\n` +
      `<code>${keyItem.access_key}</code>\n\n` +
      `👆 <i>Key စာသားကို ဖိနှိပ် (Tap) ၍ Copy ကူးယူအသုံးပြုနိုင်ပါတယ်ခင်ဗျာ။ ဝယ်ယူထားသော Key များကို <b>👤 Profile</b> ထဲတွင်လည်း အချိန်မရွေး ပြန်လည်ကြည့်ရှုနိုင်ပါသည်။</i>`;

    await editMsg(deliveryMsg, {
      inline_keyboard: [
        [{ text: "👤 ဝယ်ထားသော Key များ စစ်မည်", callback_data: "menu_profile_p_1" }],
        [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
      ]
    });
    return;
  }

  // Free Test Key
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
          `<b>Test Key</b>\n` +
          `<b>━━━━━━━━━━━━━━</b>\n\n` +
          `⚠️<b>မင်္ဂလာပါခင်ဗျာ၊ သင်သည် Test Key ရယူထားပြီး ဖြစ်ပါသည်!</b>\n\n` +
          `• 📅 ရယူခဲ့သည့်ရက်: <b>${formatMyanmarTime(lastClaim)}</b>\n` +
          `• ⏳ နောက်တစ်ကြိမ် ရယူနိုင်မည့်ရက်: <b>${formatMyanmarTime(nextDate)}</b>\n\n` +
          `<i>နောက်ထပ် Key အသစ် ရယူနိုင်ဖို့ <b>${days} ရက်နှင့် ${hours} နာရီ</b> လိုပါသေးတယ်ခင်ဗျာ။</i>\n\n` +
          `ရယူထားပြီးသား Test Key ကို ပြန်လည်ကြည့်ရှုလိုပါက အောက်ပါခလုတ်လေးကို နှိပ်ပေးပါနော် 👇`,
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

    const testKeyItem = await env.DB.prepare(
      "SELECT id, access_key FROM keys WHERE category = 'test' LIMIT 1"
    ).first();

    if (!testKeyItem) {
      await editMsg(
        "😔 စိတ်မကောင်းပါခင်ဗျာ၊ လက်ရှိတွင် Free Test Key များ Stock ပြတ်လပ်နေပါသဖြင့် ခေတ္တ စောင့်ဆိုင်းပေးပါနော်။",
        {
          inline_keyboard: [
            [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }],
            [{ text: "💬 Support သို့ မေးမြန်းမည်", url: "https://t.me/JaiwaJG" }]
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
      `🎉 <b>သင့်အတွက် Outline Free Test Key ရရှိပါပြီခင်ဗျာ!</b>\n` +
      `<b>━━━━━━━━━━━━━━</b>\n\n` +
      `<code>${testKeyItem.access_key}</code>\n\n` +
      `👆 <i>Key စာသားကို ဖိနှိပ် (Tap) ၍ Copy ကူးယူအသုံးပြုနိုင်ပါတယ်ခင်ဗျာ။</i>`,
      {
        inline_keyboard: [
          [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
        ]
      }
    );
    return;
  }

  // ရယူထားသော Test Key အား ပြန်လည်ပြသခြင်း
  if (data === "view_claimed_test_key") {
    const keyStr = user.current_test_key || "Key ရှာမတွေ့ပါ။";
    await editMsg(
      `🔑 <b>သင် ရယူထားသော Outline Test Key ဖြစ်ပါသည်:</b>\n\n` +
      `<code>${keyStr}</code>\n\n` +
      `👆 <i>Key စာသားကို ဖိနှိပ် (Tap) ၍ Copy ကူးယူနိုင်ပါတယ်ခင်ဗျာ။</i>`,
      {
        inline_keyboard: [
          [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "menu_home" }]
        ]
      }
    );
    return;
  }
}
