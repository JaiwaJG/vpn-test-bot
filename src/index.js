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

async function tg(env, method, payload) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function handleMessage(msg, env) {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const adminId = Number(env.ADMIN_GROUP_ID);

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
          [{ text: "ℹ️ ကျွန်ုပ်၏ Status စစ်ဆေးမည်", callback_data: "check_my_status" }]
        ],
      },
    });
    return;
  }

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
          text: "⚠️ <b>ထည့်သွင်းမှု မအောင်မြင်ပါ!</b>\n\nပုံစံ: <code>/addkeys</code> ဟု ပထမကြောင်းတွင်ရေးပြီး နောက်ကြောင်းများတွင် <code>ss://...</code> key များကို paste လုပ်ပေးပါ။",
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
          });
          return;
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
}

async function handleCallback(cb, env) {
  const userId = cb.from.id;
  const username = cb.from.username || "Unknown";
  const callbackId = cb.id;
  const chatId = cb.message.chat.id;

  if (cb.data === "check_my_status") {
    const user = await env.DB.prepare("SELECT last_claimed_at FROM users WHERE telegram_id = ?").bind(userId).first();

    if (!user || !user.last_claimed_at) {
      await tg(env, "answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "✨ သင်သည် Test Key လုံးဝ မယူရသေးပါ။ ယခုပင် ရယူနိုင်ပါသည်!",
        show_alert: true,
      });
      return;
    }

    const lastClaim = new Date(user.last_claimed_at).getTime();
    const now = Date.now();
    const diffDays = Math.floor((now - lastClaim) / (1000 * 60 * 60 * 24));
    const remainingDays = 30 - diffDays;

    if (remainingDays > 0) {
      await tg(env, "answerCallbackQuery", {
        callback_query_id: callbackId,
        text: `⏳ သင် Test Key ယူထားပြီး ဖြစ်ပါသည်။ နောက်ထပ် key ယူနိုင်ရန် ${remainingDays} ရက် လိုပါသေးသည်။`,
        show_alert: true,
      });
    } else {
      await tg(env, "answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "🎉 ရက်ပေါင်း (၃၀) ပြည့်သွားပါပြီ! Key အသစ် ပြန်လည်ရယူနိုင်ပါပြီ။",
        show_alert: true,
      });
    }
    return;
  }

  if (cb.data === "get_test_key") {
    const user = await env.DB.prepare(
      "SELECT last_claimed_at FROM users WHERE telegram_id = ?"
    ).bind(userId).first();

    if (user && user.last_claimed_at) {
      const lastClaim = new Date(user.last_claimed_at).getTime();
      const now = Date.now();
      const diffDays = Math.floor((now - lastClaim) / (1000 * 60 * 60 * 24));

      if (diffDays < 30) {
        const remainingDays = 30 - diffDays;
        await tg(env, "answerCallbackQuery", {
          callback_query_id: callbackId,
          text: `⚠️ ခွင့်မပြုပါ!\nUser တစ်ဦးလျှင် တစ်လ (၁) ကြိမ်သာ ရယူနိုင်ပါသည်။\nနောက်ထပ် ရယူနိုင်ရန် ${remainingDays} ရက် စောင့်ဆိုင်းပေးပါ။`,
          show_alert: true,
        });
        return;
      }
    }

    const freeKey = await env.DB.prepare("SELECT id, access_key FROM keys LIMIT 1").first();

    if (!freeKey) {
      await tg(env, "answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "😔 စိတ်မကောင်းပါ၊ လက်ရှိတွင် Test Key ကုန်နေပါသည်။ Stock ဖြည့်ပေးမည့်အချိန်ကို စောင့်ဆိုင်းပေးပါ။",
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
      `📲 <b>အသုံးပြုပုံ အဆင့်ဆင့်:</b>\n` +
      `1. Outline VPN App ကို ဖွင့်ပါ။\n` +
      `2. Copy ကူးလာသော Key အား ထည့်သွင်း (Paste) ပါ။\n` +
      `3. <b>Connect</b> ကို နှိပ်၍ အသုံးပြုနိုင်ပါပြီ။\n\n` +
      `⚠️ <i>ဤ Key ကို Database မှ ချက်ချင်း ဖျက်လိုက်ပြီး ဖြစ်သောကြောင့် သင်တစ်ဦးတည်းသာ ပိုင်ဆိုင်ပါသည်။</i>`;

    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: successMsg,
      parse_mode: "HTML",
    });
  }
}
