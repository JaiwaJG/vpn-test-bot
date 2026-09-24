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

// မြန်မာစံတော်ချိန် (UTC+6:30) ဖြင့် ရက်စွဲ/အချိန် format ဖော်ပေးသည့် helper
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

// Messages & Admin Commands Handling
async function handleMessage(msg, env) {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const adminId = Number(env.ADMIN_GROUP_ID);

  // --- USER SIDE: /start ---
  if (text === "/start") {
    const welcomeText = 
      `👋 <b>မင်္ဂလာပါ ${msg.from.first_name || ""}!</b>\n\n` +
      `Outline VPN Test Key များကို ဤနေရာတွင် အခမဲ့ ရယူနိုင်ပါသည်။\n\n` +
      `📌 <b>စည်းကမ်းချက်များ:</b>\n` +
      `• User တစ်ယောက်လျှင် <b>(၁) လ လျှင် (၁) ကြိမ်သာ</b> ရယူနိုင်ပါသည်။\n` +
      `• ရရှိလာသော Key ကို တစ်ဦးတည်းသာ အသုံးပြုရပါမည်။\n\n` +
      `Key ရယူရန် အောက်ပါခလုတ်ကို နှိပ်ပါ 👇`;

    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: welcomeText,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎁 Test Key ရယူမည်", callback_data: "get_test_key" }],
          [{ text: "ℹ️ Status စစ်ဆေးမည်", callback_data: "check_my_status" }],
          adminButton
        ],
      },
    });
    return;
  }

  // --- ADMIN PRIVATE GROUP SIDE ---
  if (chatId === adminId) {
    // ၁။ Stock စစ်ဆေးခြင်း (/stock)
    if (text === "/stock") {
      const stock = await env.DB.prepare("SELECT COUNT(*) as count FROM keys").first();
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `📊 <b>လက်ရှိ Test Key Stock အခြေအနေ</b>\n\nလက်ကျန်: <b>${stock.count}</b> ခု`,
        parse_mode: "HTML",
      });
      return;
    }

    // ၂။ Key အများကြီး စာသားဖြင့် သွင်းခြင်း (/addkeys)
    if (text.startsWith("/addkeys")) {
      const lines = text.replace("/addkeys", "").trim().split("\n");
      const validKeys = lines
        .map((k) => k.trim())
        .filter((k) => k.startsWith("ss://"));

      if (validKeys.length === 0) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: "⚠️ <b>ထည့်သွင်းမှု မအောင်မြင်ပါ!</b>\n\nပုံစံ: <code>/addkeys</code> ဟု ပထမကြောင်းတွင်ရေးပြီး အောက်စာကြောင်းများတွင် <code>ss://...</code> key များကို တစ်ကြောင်းချင်းစီ paste လုပ်ပေးပါ။",
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

    // ၃။ Admin Help
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

  // ၄။ File (.txt) ဖြင့် Key ထည့်ခြင်း (Admin Group)
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

// Inline Callback Handling
async function handleCallback(cb, env) {
  const userId = cb.from.id;
  const username = cb.from.username || "Unknown";
  const callbackId = cb.id;
  const chatId = cb.message.chat.id;
  const adminId = Number(env.ADMIN_GROUP_ID);

  // --- Admin Group: Stock စစ်ဆေးခြင်း ခလုတ် ---
  if (cb.data === "admin_check_stock" && chatId === adminId) {
    const stock = await env.DB.prepare("SELECT COUNT(*) as count FROM keys").first();
    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: `📊 <b>လက်ရှိ Test Key Stock အခြေအနေ</b>\n\nလက်ကျန်: <b>${stock.count}</b> ခု`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔄 Refresh Stock", callback_data: "admin_check_stock" }]
        ]
      }
    });
    return;
  }

  // --- User: Key ထည့်သွင်းနည်း လမ်းညွှန် ခလုတ် ---
  if (cb.data === "how_to_use") {
    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });

    const guideMsg = 
      `📖 <b>Outline VPN အသုံးပြုပုံ အဆင့်ဆင့်</b>\n\n` +
      `1. ဖုန်းတွင် <b>Outline App</b> ကို ဖွင့်ပါ။ (မရှိသေးပါက Play Store / App Store မှ ဒေါင်းလုဒ်ဆွဲပါ)\n` +
      `2. အပေါ်တွင် ရရှိထားသော <code>ss://...</code> Key ကို ဖိနှိပ်၍ Copy ကူးပါ။\n` +
      `3. Outline App ထဲသို့ ဝင်လိုက်ပါက Key အလိုအလျောက် ပေါ်လာပါမည်။ (မပေါ်ပါက ညာဘက်အပေါ်ရှိ <b>+</b> ခလုတ်ကို နှိပ်ပြီး Paste ချပါ)\n` +
      `4. <b>"Add Server"</b> ကို နှိပ်ပြီးနောက် <b>Connect</b> ကို နှိပ်၍ အင်တာနက် အသုံးပြုနိုင်ပါပြီ။`;

    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: guideMsg,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "ℹ️ Status စစ်ဆေးမည်", callback_data: "check_my_status" }],
          adminButton
        ],
      },
    });
    return;
  }

  // --- User: Status စစ်ဆေးခြင်း ခလုတ် ---
  if (cb.data === "check_my_status") {
    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });

    const user = await env.DB.prepare("SELECT last_claimed_at FROM users WHERE telegram_id = ?").bind(userId).first();

    if (!user || !user.last_claimed_at) {
      const notClaimedText = 
        `ℹ️ <b>သင်၏ အကောင့်အခြေအနေ (Status)</b>\n\n` +
        `👤 <b>အမည်:</b> ${cb.from.first_name || username}\n` +
        `📌 <b>အခြေအနေ:</b> သင်သည် Test Key လုံးဝ မယူရသေးပါ ✨\n\n` +
        `👉 အောက်ပါခလုတ်ကို နှိပ်ပြီး ယခုပင် အခမဲ့ ရယူနိုင်ပါသည်!`;

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: notClaimedText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎁 Test Key ရယူမည်", callback_data: "get_test_key" }],
            adminButton
          ],
        },
      });
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

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: statusMsg,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            adminButton
          ],
        },
      });
    } else {
      const readyMsg = 
        `ℹ️ <b>သင်၏ Test Key အခြေအနေ (Status)</b>\n\n` +
        `👤 <b>အမည်:</b> ${cb.from.first_name || username}\n` +
        `🎉 <b>ရက်ပေါင်း (၃၀) ပြည့်သွားပါပြီ!</b>\n\n` +
        `ယခုအခါ နောက်ထပ် Test Key အသစ်တစ်ခုကို ပြန်လည်ရယူနိုင်ပါပြီ။`;

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: readyMsg,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎁 Test Key ရယူမည်", callback_data: "get_test_key" }],
            adminButton
          ],
        },
      });
    }
    return;
  }

  // --- User: Test Key ထုတ်ယူခြင်း Button ---
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
        "INSERT INTO users (telegram_id, username, last_claimed_at) VALUES (?, ?, CURRENT_TIMESTAMP) " +
        "ON CONFLICT(telegram_id) DO UPDATE SET last_claimed_at = CURRENT_TIMESTAMP, username = ?"
      ).bind(userId, username, username),
      env.DB.prepare("DELETE FROM keys WHERE id = ?").bind(freeKey.id)
    ]);

    await tg(env, "answerCallbackQuery", { callback_query_id: callbackId });

    const successMsg = 
      `🎉 <b>သင်၏ Outline Test Key ရရှိပါပြီ!</b>\n\n` +
      `<code>${freeKey.access_key}</code>\n\n` +
      `👆 <i>အပေါ်က Key စာသားကို ဖိနှိပ် (Tap) လိုက်ရုံဖြင့် အလိုအလျောက် Copy ကူးသွားပါမည်။</i>\n\n` +
      `⚠️ <i>ဤ Key ကို Database မှ ချက်ချင်း ဖျက်ထုတ်လိုက်ပြီး ဖြစ်သောကြောင့် သင်တစ်ဦးတည်းသာ ပိုင်ဆိုင်ပါသည်။</i>`;

    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: successMsg,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "ℹ️ Status စစ်ဆေးမည်", callback_data: "check_my_status" },
            { text: "📖 Key ထည့်သွင်းနည်း", callback_data: "how_to_use" }
          ],
          adminButton
        ],
      },
    });
  }
}
