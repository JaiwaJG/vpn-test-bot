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
      console.error(err);
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

// Contact Admin Button Helper
const adminButton = [{ text: "💬 Contact Admin", url: "https://t.me/JaiwaJG" }];

// မြန်မာစံတော်ချိန် (UTC+6:30) ဖြင့် format ဖော်ပေးသည့် helper
function formatMyanmarTime(dateObj) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(dateObj);
}

// User ရဲ့ လက်ရှိ အခြေအနေပေါ်မူတည်ပြီး Dynamic Start Menu ဆောက်ပေးသည့် function
async function getStartMenu(env, userId) {
  const user = await env.DB.prepare(
    "SELECT last_claimed_at, current_key FROM users WHERE telegram_id = ?"
  ).bind(userId).first();

  let isClaimedAndActive = false;
  if (user && user.last_claimed_at && user.current_key) {
    const lastClaimDate = new Date(user.last_claimed_at.replace(" ", "T") + "Z");
    const nextAvailableDate = new Date(lastClaimDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (new Date() < nextAvailableDate) {
      isClaimedAndActive = true;
    }
  }

  let inlineKeyboard = [];
  if (isClaimedAndActive) {
    inlineKeyboard = [
      [{ text: "🔑 ကျွန်ုပ်၏ Key ပြန်လည်ကြည့်ရှုမည်", callback_data: "view_my_key" }],
      [
        { text: "ℹ️ ကျွန်ုပ်၏ Status စစ်ဆေးမည်", callback_data: "check_my_status" },
        { text: "📖 Key ထည့်သွင်းနည်း", callback_data: "how_to_use" }
      ],
      [{ text: "💰 VPN ဈေးနှုန်းများ ကြည့်ရှုမည်", callback_data: "view_pricing" }],
      adminButton
    ];
  } else {
    inlineKeyboard = [
      [{ text: "🎁 Test Key ရယူမည်", callback_data: "get_test_key" }],
      [{ text: "ℹ️ ကျွန်ုပ်၏ Status စစ်ဆေးမည်", callback_data: "check_my_status" }],
      [{ text: "💰 VPN ဈေးနှုန်းများ ကြည့်ရှုမည်", callback_data: "view_pricing" }],
      adminButton
    ];
  }

  const welcomeText = 
    `👋 <b>မင်္ဂလာပါ!</b>\n\n` +
    `Outline VPN Test Key များကို ဤနေရာတွင် အခမဲ့ ရယူနိုင်ပါသည်။\n\n` +
    `📌 <b>စည်းကမ်းချက်များ:</b>\n` +
    `• User တစ်ယောက်လျှင် <b>(၁) လ လျှင် (၁) ကြိမ်သာ</b> ရယူနိုင်ပါသည်။\n` +
    `• ရရှိလာသော Key ကို တစ်ဦးတည်းသာ အသုံးပြုရပါမည်။\n\n` +
    `လိုရာ ရွေးချယ်နိုင်ပါသည် 👇`;

  return { text: welcomeText, reply_markup: { inline_keyboard: inlineKeyboard } };
}

// Messages & Admin Commands Handling
async function handleMessage(msg, env) {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const userId = msg.from.id;
  const adminId = Number(env.ADMIN_GROUP_ID);

  // --- USER SIDE: /start ---
  if (text === "/start") {
    const startData = await getStartMenu(env, userId);
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: startData.text,
      parse_mode: "HTML",
      reply_markup: startData.reply_markup,
    });
    return;
  }

  // --- ADMIN PRIVATE GROUP SIDE ---
  if (chatId === adminId) {
    if (text === "/stock") {
      const stock = await env.DB.prepare("SELECT COUNT(*) as count FROM keys").first();
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `📊 <b>လက်ရှိ Test Key Stock အခြေအနေ</b>\n\nလက်ကျန်: <b>${stock.count}</b> ခု`,
        parse_mode: "HTML",
      });
      return;
    }

    if (text.startsWith("/addkeys")) {
      const lines = text.replace("/addkeys", "").trim().split("\n");
      const validKeys = lines
        .map((k) => k.trim())
        .filter((k) => k.startsWith("ss://"));

      if (validKeys.length === 0) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: "⚠️ <b>ထည့်သွင်းမှု မအောင်မြင်ပါ!</b>\n\nပုံစံ: <code>/addkeys</code> ဟု ပထမကြောင်းတွင်ရေးပြီး အောက်စာကြောင်းများတွင် <code>ss://...</code> key များကို paste လုပ်ပေးပါ။",
          parse_mode: "HTML",
        });
        return;
      }

      const stmts = validKeys.map((key) =>
        env.DB.prepare("INSERT OR IGNORE INTO keys (access_key) VALUES (?)").bind(key)
      );
      await env.DB.batch(stmts);

      const stock = await env.DB.prepare("SELECT COUNT(*) as count FROM keys").first();
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `✅ <b>Key များ အောင်မြင်စွာ ထည့်သွင်းပြီးပါပြီ!</b>\n\n• အသစ်ထည့်ဝင်: <b>${validKeys.length}</b> ခု\n• လက်ကျန်စုစုပေါင်း: <b>${stock.count}</b> ခု`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📊 Stock စစ်ဆေးမည်", callback_data: "admin_check_stock" }]
          ]
        }
      });
      return;
    }

    if (text === "/help") {
      const helpText = 
        `🛠 <b>Admin Commands စာရင်း:</b>\n\n` +
        `• <code>/stock</code> - လက်ကျန် key အရေအတွက် စစ်ဆေးရန်\n` +
        `• <code>/addkeys</code> [စာကြောင်းချပြီး key များထည့်ပါ] - Stock သွင်းရန်\n` +
        `• File ပို့ပြီး Caption တွင် <code>/addfile</code> ဟုရေး၍လည်း Stock သွင်းနိုင်ပါသည်။`;
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: helpText,
        parse_mode: "HTML",
      });
      return;
    }
  }

  // File (.txt) ဖြင့် Key ထည့်ခြင်း
  if (chatId === adminId && msg.document && msg.caption && msg.caption.includes("/addfile")) {
    try {
      const fileRes = await tg(env, "getFile", { file_id: msg.document.file_id });
      const fileData = await fileRes.json();
      
      if (fileData.ok) {
        const downloadUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileData.result.file_path}`;
        const fileContent = await (await fetch(downloadUrl)).text();
        
        const validKeys = fileContent
          .split("\n")
          .map((k) => k.trim())
          .filter((k) => k.startsWith("ss://"));

        if (validKeys.length > 0) {
          const stmts = validKeys.map((key) =>
            env.DB.prepare("INSERT OR IGNORE INTO keys (access_key) VALUES (?)").bind(key)
          );
          await env.DB.batch(stmts);
          
          const stock = await env.DB.prepare("SELECT COUNT(*) as count FROM keys").first();
          await tg(env, "sendMessage", {
            chat_id: chatId,
            text: `✅ <b>File ထဲမှ Key များ ထည့်သွင်းပြီးပါပြီ!</b>\n\n• ထည့်ဝင်ပြီး: <b>${validKeys.length}</b> ခု\n• လက်ကျန်စုစုပေါင်း: <b>${stock.count}</b> ခု`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "📊 Stock စစ်ဆေးမည်", callback_data: "admin_check_stock" }]
              ]
            }
          });
          return;
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
}

// Inline Callback Handling (Message အဟောင်းကို အသစ်ဖြင့် Edit ပြုလုပ်ခြင်း)
async function handleCallback(cb, env) {
  const userId = cb.from.id;
  const username = cb.from.username || "Unknown";
  const callbackId = cb.id;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const adminId = Number(env.ADMIN_GROUP_ID);

  // စာသားကို နေရာမှာတင် အစားထိုးပေးမည့် Helper Function
  async function editMessage(text, replyMarkup) {
    await tg(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }

  // --- Admin Group: Stock စစ်ခြင်း ---
  if (cb.data === "admin_check_stock" && chatId === adminId) {
    const stock = await env.DB.prepare("SELECT COUNT(*) as count FROM keys").first();
    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });
    await editMessage(
      `📊 <b>လက်ရှိ Test Key Stock အခြေအနေ</b>\n\nလက်ကျန်: <b>${stock.count}</b> ခု`,
      {
        inline_keyboard: [
          [{ text: "🔄 Refresh Stock", callback_data: "admin_check_stock" }]
        ]
      }
    );
    return;
  }

  // --- ပင်မစာမျက်နှာသို့ ပြန်သွားရန် (Back to Main Menu) ---
  if (cb.data === "back_to_menu") {
    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });
    const startData = await getStartMenu(env, userId);
    await editMessage(startData.text, startData.reply_markup);
    return;
  }

  // --- VPN ဈေးနှုန်းများ ကြည့်ရှုခြင်း (Pricing Plans) ---
  if (cb.data === "view_pricing") {
    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });

    const pricingMsg = 
      `⚡️ <b>Outline VPN Premium Package ဈေးနှုန်းများ</b> ⚡️\n\n` +
      `လိုင်းဆွဲအား မြန်ဆန်ပြီး Security စိတ်ချရသော High-speed Servers များကို အသုံးပြုနိုင်ပါသည်။\n\n` +
      `💎 <b>Package စာရင်းများ:</b>\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `🔹 <b>၁ လ သက်တမ်း (1 Month)</b>\n` +
      `• ဈေးနှုန်း: <b>5,000 MMK</b>\n` +
      `• Unlimited Data | High Speed\n\n` +
      `🔹 <b>၃ လ သက်တမ်း (3 Months)</b>\n` +
      `• ဈေးနှုန်း: <b>13,000 MMK</b> (သက်သာ)\n` +
      `• Unlimited Data | High Speed\n\n` +
      `🔹 <b>၆ လ သက်တမ်း (6 Months)</b>\n` +
      `• ဈေးနှုန်း: <b>25,000 MMK</b> (လူကြိုက်အများဆုံး)\n` +
      `• Unlimited Data | VIP Support\n` +
      `━━━━━━━━━━━━━━━━━\n\n` +
      `🛒 <b>ဝယ်ယူရန် သို့မဟုတ် စုံစမ်းရန်:</b>\n` +
      `အောက်ပါ <b>Contact Admin</b> ခလုတ်ကို နှိပ်၍ တိုက်ရိုက် ဆက်သွယ်ဝယ်ယူနိုင်ပါသည် 👇`;

    await editMessage(
      pricingMsg,
      {
        inline_keyboard: [
          adminButton,
          [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "back_to_menu" }]
        ]
      }
    );
    return;
  }

  // --- Key ပြန်လည်ကြည့်ရှုခြင်း (View My Key) ---
  if (cb.data === "view_my_key") {
    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });

    const user = await env.DB.prepare(
      "SELECT current_key FROM users WHERE telegram_id = ?"
    ).bind(userId).first();

    if (!user || !user.current_key) {
      await editMessage(
        "⚠️ သင်သည် Test Key မယူရသေးပါ။",
        {
          inline_keyboard: [
            [{ text: "🎁 Test Key ရယူမည်", callback_data: "get_test_key" }],
            [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "back_to_menu" }],
            adminButton
          ]
        }
      );
      return;
    }

    const keyMsg = 
      `🔑 <b>သင်၏ Outline Test Key ဖြစ်ပါသည်:</b>\n\n` +
      `<code>${user.current_key}</code>\n\n` +
      `👆 <i>Key ကို ဖိနှိပ် (Tap) ၍ Copy ယူနိုင်ပါသည်။</i>`;

    await editMessage(
      keyMsg,
      {
        inline_keyboard: [
          [
            { text: "ℹ️ Status စစ်ဆေးမည်", callback_data: "check_my_status" },
            { text: "📖 Key ထည့်သွင်းနည်း", callback_data: "how_to_use" }
          ],
          [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "back_to_menu" }],
          adminButton
        ]
      }
    );
    return;
  }

  // --- Key ထည့်သွင်းနည်း လမ်းညွှန် ---
  if (cb.data === "how_to_use") {
    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });

    const guideMsg = 
      `📖 <b>Outline VPN အသုံးပြုပုံ အဆင့်ဆင့်</b>\n\n` +
      `1. ဖုန်းတွင် <b>Outline App</b> ကို ဖွင့်ပါ။\n` +
      `2. အပေါ်တွင် ရရှိထားသော <code>ss://...</code> Key ကို Copy ကူးပါ။\n` +
      `3. Outline App ထဲသို့ ဝင်လိုက်ပါက Key အလိုအလျောက် ပေါ်လာပါမည်။ (မပေါ်ပါက ညာဘက်အပေါ်ရှိ <b>+</b> ခလုတ်ကို နှိပ်ပြီး Paste ချပါ)\n` +
      `4. <b>"Add Server"</b> ကို နှိပ်ပြီးနောက် <b>Connect</b> ကို နှိပ်၍ စတင် အသုံးပြုနိုင်ပါပြီ။`;

    await editMessage(
      guideMsg,
      {
        inline_keyboard: [
          [
            { text: "🔑 ကျွန်ုပ်၏ Key ကြည့်မည်", callback_data: "view_my_key" },
            { text: "ℹ️ Status စစ်ဆေးမည်", callback_data: "check_my_status" }
          ],
          [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "back_to_menu" }],
          adminButton
        ]
      }
    );
    return;
  }

  // --- Status စစ်ဆေးခြင်း ---
  if (cb.data === "check_my_status") {
    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });

    const user = await env.DB.prepare("SELECT last_claimed_at, current_key FROM users WHERE telegram_id = ?").bind(userId).first();

    if (!user || !user.last_claimed_at) {
      const notClaimedText = 
        `ℹ️ <b>သင်၏ အကောင့်အခြေအနေ (Status)</b>\n\n` +
        `👤 <b>အမည်:</b> ${cb.from.first_name || username}\n` +
        `📌 <b>အခြေအနေ:</b> သင်သည် Test Key လုံးဝ မယူရသေးပါ ✨\n\n` +
        `👉 အောက်ပါခလုတ်ကို နှိပ်ပြီး ယခုပင် အခမဲ့ ရယူနိုင်ပါသည်!`;

      await editMessage(
        notClaimedText,
        {
          inline_keyboard: [
            [{ text: "🎁 Test Key ရယူမည်", callback_data: "get_test_key" }],
            [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "back_to_menu" }],
            adminButton
          ]
        }
      );
      return;
    }

    const lastClaimDate = new Date(user.last_claimed_at.replace(" ", "T") + "Z");
    const nextAvailableDate = new Date(lastClaimDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const now = new Date();

    const claimedTimeStr = formatMyanmarTime(lastClaimDate);
    const nextTimeStr = formatMyanmarTime(nextAvailableDate);

    if (now < nextAvailableDate) {
      const remainingMs = nextAvailableDate - now;
      const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
      const remainingHours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      const statusMsg = 
        `ℹ️ <b>သင်၏ Test Key အခြေအနေ (Status)</b>\n\n` +
        `👤 <b>အမည်:</b> ${cb.from.first_name || username}\n` +
        `📅 <b>ရယူခဲ့သည့်နေ့:</b> ${claimedTimeStr}\n` +
        `⏳ <b>နောက်တစ်ကြိမ် ယူနိုင်မည့်နေ့:</b> ${nextTimeStr}\n\n` +
        `⚠️ <i>နောက်ထပ် Key အသစ် ရယူနိုင်ရန် <b>${remainingDays} ရက် နှင့် ${remainingHours} နာရီ</b> လိုပါသေးသည်။</i>`;

      await editMessage(
        statusMsg,
        {
          inline_keyboard: [
            [{ text: "🔑 ကျွန်ုပ်၏ Key ပြန်လည်ကြည့်ရှုမည်", callback_data: "view_my_key" }],
            [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "back_to_menu" }],
            adminButton
          ]
        }
      );
    } else {
      const readyMsg = 
        `ℹ️ <b>သင်၏ Test Key အခြေအနေ (Status)</b>\n\n` +
        `👤 <b>အမည်:</b> ${cb.from.first_name || username}\n` +
        `🎉 <b>ရက်ပေါင်း (၃၀) ပြည့်သွားပါပြီ!</b>\n\n` +
        `ယခုအခါ နောက်ထပ် Test Key အသစ်တစ်ခုကို ပြန်လည်ရယူနိုင်ပါပြီ။`;

      await editMessage(
        readyMsg,
        {
          inline_keyboard: [
            [{ text: "🎁 Test Key ရယူမည်", callback_data: "get_test_key" }],
            [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "back_to_menu" }],
            adminButton
          ]
        }
      );
    }
    return;
  }

  // --- Test Key ထုတ်ယူခြင်း ---
  if (cb.data === "get_test_key") {
    const user = await env.DB.prepare(
      "SELECT last_claimed_at FROM users WHERE telegram_id = ?"
    ).bind(userId).first();

    if (user && user.last_claimed_at) {
      const lastClaimDate = new Date(user.last_claimed_at.replace(" ", "T") + "Z");
      const nextAvailableDate = new Date(lastClaimDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      const now = new Date();

      if (now < nextAvailableDate) {
        const remainingMs = nextAvailableDate - now;
        const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
        const remainingHours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const nextTimeStr = formatMyanmarTime(nextAvailableDate);

        await tg(env, "answerCallbackQuery", {
          callback_query_id: callbackId,
          text: `⚠️ Test Key ရယူပြီးသား ဖြစ်ပါသည်!\nနောက်ထပ် ရယူနိုင်မည့်နေ့: ${nextTimeStr} (${remainingDays} ရက်နှင့် ${remainingHours} နာရီ လိုပါသေးသည်)`,
          show_alert: true,
        });
        return;
      }
    }

    const freeKey = await env.DB.prepare("SELECT id, access_key FROM keys LIMIT 1").first();

    if (!freeKey) {
      await tg(env, "answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "😔 စိတ်မကောင်းပါ၊ လက်ရှိတွင် Test Key ကုန်နေပါသည်။ Stock ပြန်ဖြည့်ချိန်ကို စောင့်ဆိုင်းပေးပါ။",
        show_alert: true,
      });
      return;
    }

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (telegram_id, username, last_claimed_at, current_key) VALUES (?, ?, CURRENT_TIMESTAMP, ?) " +
        "ON CONFLICT(telegram_id) DO UPDATE SET last_claimed_at = CURRENT_TIMESTAMP, username = ?, current_key = ?"
      ).bind(userId, username, freeKey.access_key, username, freeKey.access_key),
      env.DB.prepare("DELETE FROM keys WHERE id = ?").bind(freeKey.id)
    ]);

    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });

    const successMsg = 
      `🎉 <b>သင်၏ Outline Test Key ရရှိပါပြီ!</b>\n\n` +
      `<code>${freeKey.access_key}</code>\n\n` +
      `👆 <i>အပေါ်က Key စာသားကို ဖိနှိပ် (Tap) လိုက်ရုံဖြင့် အလိုအလျောက် Copy ကူးသွားပါမည်။</i>\n\n` +
      `⚠️ <i>ဤ Key ကို Stock မှ ဖျက်ထုတ်လိုက်ပြီး ဖြစ်သောကြောင့် သင်တစ်ဦးတည်းသာ ပိုင်ဆိုင်ပါသည်။ ပျောက်သွားပါက အချိန်မရွေး ပြန်လည်ကြည့်ရှုနိုင်ပါသည်။</i>`;

    await editMessage(
      successMsg,
      {
        inline_keyboard: [
          [
            { text: "ℹ️ Status စစ်ဆေးမည်", callback_data: "check_my_status" },
            { text: "📖 Key ထည့်သွင်းနည်း", callback_data: "how_to_use" }
          ],
          [{ text: "🔙 ပင်မစာမျက်နှာသို့", callback_data: "back_to_menu" }],
          adminButton
        ]
      }
    );
  }
}
