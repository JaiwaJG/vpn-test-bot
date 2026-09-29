import { CONFIG, e, makeBtn } from "./config.js";
import * as KB from "./keyboards.js";
import * as MSG from "./messages.js";

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

// Telegram Request Helper
async function tg(env, method, payload) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// User Record Finder
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

// Main Message Processor
async function handleMessage(msg, env) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || "").trim();
  const paymentGroupId = String(env.PAYMENT_GROUP_ID || "").trim();
  const stockGroupId = String(env.STOCK_GROUP_ID || "").trim();

  // --- 1. USER PRIVATE CHAT ---
  if (!chatId.startsWith("-")) {
    const user = await getOrCreateUser(env, msg.from);

    if (user.is_banned === 1) {
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `${e("BAN", "🚫")} <b>Access Denied:</b> Your account has been permanently suspended due to violation of store rules.`,
        parse_mode: "HTML",
      });
      return;
    }

    if (text.startsWith("/start")) {
      await env.DB.prepare("UPDATE users SET pending_topup_amount = 0 WHERE telegram_id = ?").bind(user.telegram_id).run();
      
      const param = text.split(" ")[1];
      if (param === "menu_buy") {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: MSG.getPackageListMessage(Number(user.balance || 0)),
          parse_mode: "HTML",
          reply_markup: KB.getBuyPackagesKeyboard(),
        });
        return;
      }

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: MSG.getWelcomeMessage(msg.from.first_name),
        parse_mode: "HTML",
        reply_markup: KB.getMainKeyboard(),
      });
      return;
    }

    // Custom Top Up Amount Input Handler
    if (user.pending_topup_amount === -1 && text) {
      const cleanNum = text.replace(/,/g, "").trim();
      const amount = parseInt(cleanNum, 10);

      if (isNaN(amount) || amount < CONFIG.PAYMENT.MIN_TOPUP) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: `${e("WARNING", "⚠️")} <b>Invalid Amount!</b>\nMinimum deposit is <b>${CONFIG.PAYMENT.MIN_TOPUP.toLocaleString()} MMK</b>.\nPlease send digits only (e.g. <code>2500</code> or <code>5000</code>).`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[makeBtn("Back to Home", "callback_data", "menu_home")]] }
        });
        return;
      }

      await env.DB.prepare("UPDATE users SET pending_topup_amount = ? WHERE telegram_id = ?").bind(amount, user.telegram_id).run();

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: MSG.getPaymentInfoMessage(amount),
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "🔙 Change Amount", callback_data: "menu_topup" }]] }
      });
      return;
    }

    // Slip Photo Submission Handler
    if (msg.photo && msg.photo.length > 0) {
      const currentAmt = Number(user.pending_topup_amount || 0);

      if (currentAmt <= 0) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: `${e("WARNING", "⚠️")} Please select a deposit amount from ${e("DEPOSIT", "💳")}<b>Deposit</b> menu before uploading payment screenshot.`,
          parse_mode: "HTML",
          reply_markup: KB.getMainKeyboard(),
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
        text: `${e("DONE", "✅")} <b>Payment Slip Received!</b>\n\nAmount: <b>${currentAmt.toLocaleString()} MMK</b>\nOur team is verifying your payment. ${e("CLOCK", "⏳")} \nYour wallet balance will be credited within <b>5 Minutes to 24 Hours maximum</b> automatically once approved.\n\nHave A Great Day ${e("STAR", "✨" )}`,
        parse_mode: "HTML",
      });

      if (paymentGroupId) {
        const captionText = 
          `${e("DEPOSIT", "💳")} <b>New Deposit Request (#ID_${requestId})</b>\n` +
          `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
          `• <b>User:</b> ${msg.from.first_name || ""} (<code>${user.telegram_id}</code>)\n` +
          `• <b>Username:</b> @${msg.from.username || "None"}\n` +
          `• <b>Amount:</b> <b>${currentAmt.toLocaleString()} MMK</b>\n` +
          `• <b>Time:</b> ${MSG.formatMyanmarTime(new Date())}\n\n` +
          `${e("DOWN", "👇")} <i>Verify bank transaction and select action:</i>`;

        await tg(env, "sendPhoto", {
          chat_id: paymentGroupId,
          photo: photo.file_id,
          caption: captionText,
          parse_mode: "HTML",
          reply_markup: KB.getPaymentAdminKeyboard(requestId, user.telegram_id, currentAmt)
        });
      }
      return;
    }
  }

  // --- 2. PAYMENT AUDIT GROUP COMMANDS ---
  if (paymentGroupId && chatId === paymentGroupId) {
    if (text.startsWith("/ban")) {
      const targetId = text.split(" ")[1]?.trim();
      if (targetId) {
        await env.DB.prepare("UPDATE users SET is_banned = 1 WHERE telegram_id = ?").bind(targetId).run();
        await tg(env, "sendMessage", { chat_id: chatId, text: `${e("BAN", "🚫")} User <code>${targetId}</code> has been banned.`, parse_mode: "HTML" });
      }
      return;
    }
    if (text.startsWith("/unban")) {
      const targetId = text.split(" ")[1]?.trim();
      if (targetId) {
        await env.DB.prepare("UPDATE users SET is_banned = 0 WHERE telegram_id = ?").bind(targetId).run();
        await tg(env, "sendMessage", { chat_id: chatId, text: `${e("DONE", "✅")} User <code>${targetId}</code> has been unbanned.`, parse_mode: "HTML" });
      }
      return;
    }

    if (text === "/stats" || text.startsWith("/stats@")) {
      const totalReveneRes = await env.DB.prepare(
        "SELECT SUM(price) as total_rev, COUNT(*) as total_orders FROM orders"
      ).first();
      const totalUsersRes = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM users"
      ).first();

      const totalRev = totalReveneRes?.total_rev || 0;
      const totalSales = totalReveneRes?.total_orders || 0;
      const totalUsers = totalUsersRes?.count || 0;

      const statsMsg =
        `${e("STATUS", "📊")} <b>Store Analytics & Revenue Report.</b>\n` +
        `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
        `<blockquote>\n` +
        `• ${e("BALANCE", "💰")} Total Revenue: <b>${totalRev.toLocaleString()} MMK</b>\n` +
        `• ${e("STOCK", "📦")} Total Sales: <b>${totalSales}</b>\n` +
        `• ${e("USERS", "👥")} Total Users: <b>${totalUsers}</b>\n\n` +
        `</blockquote>\n\n` +
        `<b>Report Generated: ${MSG.formatMyanmarTime(new Date())}</b>`;

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: statsMsg,
        parse_mode: "HTML",
        reply_markup: KB.getStatsRefreshKeyboard()
      });
      return;
    }
  }


      // 💰 Manual Balance Management (/addbal & /subbal)
    if (text.startsWith("/addbal") || text.startsWith("/subbal")) {
      const parts = text.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const targetInput = parts[1]; // Telegram ID သို့မဟုတ် @username
      const amount = parseInt(parts[2], 10);

      // Argument စစ်ဆေးခြင်း
      if (!targetInput || isNaN(amount) || amount <= 0) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: `${e("WARNING", "⚠️")} <b>Invalid Command Format!</b>\n\n` +
                `<b>Usage:</b>\n` +
                `• <code>/addbal &lt;id or @username&gt; &lt;amount&gt;</code>\n` +
                `• <code>/subbal &lt;id or @username&gt; &lt;amount&gt;</code>\n\n` +
                `<b>Examples:</b>\n` +
                `• <code>/addbal 7271969259 5000</code>\n` +
                `• <code>/subbal @username 2500</code>`,
          parse_mode: "HTML"
        });
        return;
      }

      // User ရှာဖွေခြင်း (ID ဖြင့် သို့မဟုတ် Username ဖြင့်)
      let targetUser = null;
      if (targetInput.startsWith("@")) {
        const cleanUsername = targetInput.replace("@", "").trim();
        targetUser = await env.DB.prepare(
          "SELECT * FROM users WHERE LOWER(username) = LOWER(?)"
        ).bind(cleanUsername).first();
      } else {
        targetUser = await env.DB.prepare(
          "SELECT * FROM users WHERE telegram_id = ?"
        ).bind(targetInput.trim()).first();
      }

      if (!targetUser) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: `${e("WARNING", "❌")} <b>User Not Found:</b> <code>${targetInput}</code>\n<i>The user must have started the bot at least once.</i>`,
          parse_mode: "HTML"
        });
        return;
      }

      const isAdd = cmd.startsWith("/addbal");

      // Balance နှုတ်ယူချိန်တွင် လက်ကျန်ထက် ပိုနှုတ်မိခြင်းမှ ကာကွယ်ရန်
      if (!isAdd && targetUser.balance < amount) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: `${e("WARNING", "⚠️")} <b>Insufficient Balance!</b>\nUser's current balance is only <b>${Number(targetUser.balance).toLocaleString()} MMK</b>. Cannot deduct <b>${amount.toLocaleString()} MMK</b>.`,
          parse_mode: "HTML"
        });
        return;
      }

      // DB တွင် Balance အတိုး/အလျော့ ပြုလုပ်ခြင်း
      const sql = isAdd 
        ? "UPDATE users SET balance = balance + ? WHERE telegram_id = ?"
        : "UPDATE users SET balance = balance - ? WHERE telegram_id = ?";

      await env.DB.prepare(sql).bind(amount, targetUser.telegram_id).run();

      const updatedUser = await env.DB.prepare("SELECT balance FROM users WHERE telegram_id = ?").bind(targetUser.telegram_id).first();
      const newBal = Number(updatedUser?.balance || 0);

      // Payment Group သို့ Admin အတည်ပြုချက်စာ ပို့ခြင်း
      const actionText = isAdd ? "Credited (+)" : "Deducted (-)";
      const actionEmoji = isAdd ? e("SUCCESS", "✅") : e("WARNING", "🔻");

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `${actionEmoji} <b>Balance Updated Successfully!</b>\n` +
              `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
              `<blockquote>` +
              `• <b>User:</b> ${targetUser.first_name || ""} (<code>${targetUser.telegram_id}</code>)\n` +
              `• <b>Username:</b> @${targetUser.username || "None"}\n` +
              `• <b>Action:</b> ${actionText} <b>${amount.toLocaleString()} MMK</b>\n` +
              `• <b>New Balance:</b> <b>${newBal.toLocaleString()} MMK</b>` +
              `</blockquote>`,
        parse_mode: "HTML"
      });

      // User ထံသို့ Noti သီးသန့် အလိုအလျောက် ပို့ပေးခြင်း
      try {
        const userNotice = isAdd
          ? `${e("SUCCESS", "🎉")} <b>Balance Credited!</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
            `An admin has added <b>+${amount.toLocaleString()} MMK</b> to your wallet.\n\n` +
            `${e("BALANCE", "💰")} <b>Current Balance:</b> <code>${newBal.toLocaleString()} MMK</code>`
          : `${e("WARNING", "⚠️")} <b>Balance Deducted!</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
            `An admin has deducted <b>-${amount.toLocaleString()} MMK</b> from your wallet.\n\n` +
            `${e("BALANCE", "💰")} <b>Current Balance:</b> <code>${newBal.toLocaleString()} MMK</code>`;

        await tg(env, "sendMessage", {
          chat_id: targetUser.telegram_id,
          text: userNotice,
          parse_mode: "HTML"
        });
      } catch (err) {
        // User က Bot ကို Block ထားပါက Error မတက်ဘဲ ကျော်သွားမည်
      }

      return;
    }

      // 📢 Broadcast Announcement to All Users
    if (text.startsWith("/broadcast")) {
      const broadcastMsg = text.replace(/^\/broadcast(@\w+)?/, "").trim();
      
      if (!broadcastMsg) {
        await tg(env, "sendMessage", { 
          chat_id: chatId, 
          text: `${e("WARNING", "⚠️")}<b>Usage:</b> <code>/broadcast Your message here...</code>`, 
          parse_mode: "HTML" 
        });
        return;
      }

      // Ban မခံထားရတဲ့ active users အားလုံးကို ဆွဲထုတ်ခြင်း
      const allUsers = await env.DB.prepare("SELECT telegram_id FROM users WHERE is_banned = 0").all();
      const userList = allUsers.results || [];
      let successCount = 0;

      for (const u of userList) {
        try {
          await tg(env, "sendMessage", {
            chat_id: u.telegram_id,
            text: ` ${e("ANNOUNCE", "📢")} <b>Store Announcement</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n${broadcastMsg}`,
            parse_mode: "HTML"
          });
          successCount++;
        } catch (e) {
          // Bot ကို block ထားတဲ့ user တွေကို error မတက်ဘဲ ကျော်သွားမည်
        }
      }

      await tg(env, "sendMessage", { 
        chat_id: chatId, 
        text: `${e("DONE", "✅")} Announcement sent to <b>${successCount}/${userList.length}</b> users.`, 
        parse_mode: "HTML" 
      });
      return;
    }



  // --- 3. STOCK MANAGEMENT GROUP COMMANDS ---
  if (stockGroupId && chatId === stockGroupId) {
    const cleanCmd = text.split("@")[0].split(" ")[0].split("\n")[0];

    if (cleanCmd === "/stock") {
      const counts = await env.DB.prepare("SELECT category, COUNT(*) as count FROM keys GROUP BY category").all();
      let stockMap = { test: 0, "50gb": 0, "100gb": 0, "250gb": 0 };
      if (counts.results) {
        counts.results.forEach(r => { stockMap[r.category] = r.count; });
      }

      const stockMsg = 
        `${e("STATUS", "📊")} <b>Real-Time Key Stock Status</b>\n` +
        `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
        `• ${e("FREEBIES", "🎁")} Free Test Keys: <b>${stockMap.test}</b> items\n` +
        `• ${e("DOT", "🔹")} 50 GB Keys: <b>${stockMap["50gb"]}</b> items\n` +
        `• ${e("DOT", "🔹")} 100 GB Keys: <b>${stockMap["100gb"]}</b> items\n` +
        `• ${e("DOT", "🔹")} 250 GB Keys: <b>${stockMap["250gb"]}</b> items\n`;

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: stockMsg,
        parse_mode: "HTML",
        reply_markup: KB.getStockRefreshKeyboard()
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
          text: `${e("WARNING", "⚠️")} No keys detected. Format:\n<code>${cleanCmd}</code>\nss://key1...\nss://key2...`,
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
        text: `${e("DONE", "✅")} <b>Keys Added Successfully: [${category.toUpperCase()}]</b>\n\n• Added: <b>${validKeys.length}</b> keys\n• Total in Stock: <b>${currentStock?.count || validKeys.length}</b> keys`,
        parse_mode: "HTML",
        reply_markup: KB.getStockRefreshKeyboard()
      });
      return;
    }
  }
}

// Callback Processor
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

  // --- A. STOCK GROUP ACTIONS ---
  if (stockGroupId && chatId === stockGroupId && data === "admin_refresh_stock") {
    const counts = await env.DB.prepare("SELECT category, COUNT(*) as count FROM keys GROUP BY category").all();
    let stockMap = { test: 0, "50gb": 0, "100gb": 0, "250gb": 0 };
    if (counts.results) {
      counts.results.forEach(r => { stockMap[r.category] = r.count; });
    }
    const stockMsg = 
      `${e("STATUS", "📊")} <b>Real-Time Key Stock Status (Refreshed).</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `• ${e("FREEBIES", "🎁")} Free Test Keys: <b>${stockMap.test}</b> items\n` +
      `• ${e("DOT", "🔹")} 50 GB Keys: <b>${stockMap["50gb"]}</b> items\n` +
      `• ${e("DOT", "🔹")} 100 GB Keys: <b>${stockMap["100gb"]}</b> items\n` +
      `• ${e("DOT", "🔹")} 250 GB Keys: <b>${stockMap["250gb"]}</b> items\n\n` +
      `<i>Last updated: ${MSG.formatMyanmarTime(new Date())}</i>`;

    await editMsg(stockMsg, KB.getStockRefreshKeyboard());
    return;
  }

  // --- B. PAYMENT GROUP STATS REFRESH ---
  if (paymentGroupId && chatId === paymentGroupId && data === "admin_refresh_stats") {
    const totalRevenueRes = await env.DB.prepare(
      "SELECT SUM(price) as total_rev, COUNT(*) as total_sales FROM orders"
    ).first();
    const totalUsersRes = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM users"
    ).first();

    const totalRev = totalRevenueRes?.total_rev || 0;
    const totalSales = totalRevenueRes?.total_sales || 0;
    const totalUsers = totalUsersRes?.count || 0;

    const statsMsg = 
      `${e("STATUS", "📊")} <b>Store Analytics & Revenue Report (Refreshed)</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `<blockquote>\n` +
      `• ${e("BALANCE", "💰")} Total Revenue: <b>${totalRev.toLocaleString()} MMK</b>\n` +
      `• ${e("STOCK", "📦")} Total Sales: <b>${totalSales}</b>\n` +
      `• ${e("USERS", "👥")} Total Users: <b>${totalUsers}</b>\n\n` +
      `</blockquote>\n\n` +
      `<i>Last updated: ${MSG.formatMyanmarTime(new Date())}</i>`;

    await editMsg(statsMsg, KB.getStatsRefreshKeyboard());
    return;
  }

  // --- C. PAYMENT AUDIT ACTIONS ---
  if (paymentGroupId && chatId === paymentGroupId) {
    if (data.startsWith("pay_app_")) {
      const [, , reqId, targetUserId, amountStr] = data.split("_");
      const amount = Number(amountStr);

      await env.DB.batch([
        env.DB.prepare("UPDATE users SET balance = balance + ? WHERE telegram_id = ?").bind(amount, targetUserId),
        env.DB.prepare("UPDATE topup_requests SET status = 'approved' WHERE id = ?").bind(reqId)
      ]);

      await tg(env, "editMessageCaption", {
        chat_id: chatId,
        message_id: messageId,
        caption: (cb.message.caption || "") + `\n\n🟢 <b>APPROVED (+${amount.toLocaleString()} MMK) by Admin</b>`,
        parse_mode: "HTML"
      });

      await tg(env, "sendMessage", {
        chat_id: targetUserId,
        text: `${e("SUCCESS", "🎉")} <b>Deposit Approved!</b>\n\nYour wallet has been credited with <b>+${amount.toLocaleString()} MMK</b>.\nYou can now purchase Outline VPN keys anytime! ${e("STAR", "✨")} `,
        parse_mode: "HTML",
        reply_markup: KB.getMainKeyboard(),
      });
      return;
    }

    if (data.startsWith("pay_rej_")) {
      const [, , reqId, targetUserId] = data.split("_");
      await env.DB.prepare("UPDATE topup_requests SET status = 'rejected' WHERE id = ?").bind(reqId).run();

      await tg(env, "editMessageCaption", {
        chat_id: chatId,
        message_id: messageId,
        caption: (cb.message.caption || "") + `\n\n🔴 <b>REJECTED by Admin</b>`,
        parse_mode: "HTML"
      });

      await tg(env, "sendMessage", {
        chat_id: targetUserId,
        text: `${e("FALSE", "❌")} <b>Deposit Verification Failed:</b> We could not verify your transaction slip. Please contact support if you believe this is a mistake.`,
        parse_mode: "HTML",
        reply_markup: KB.getMainKeyboard(),
      });
      return;
    }

    if (data.startsWith("pay_ban_")) {
      const targetUserId = data.replace("pay_ban_", "");
      await env.DB.prepare("UPDATE users SET is_banned = 1 WHERE telegram_id = ?").bind(targetUserId).run();

      await tg(env, "editMessageCaption", {
        chat_id: chatId,
        message_id: messageId,
        caption: (cb.message.caption || "") + `\n\n🚫 <b>USER BANNED (Fraudulent Slip)</b>`,
        parse_mode: "HTML"
      });

      await tg(env, "sendMessage", {
        chat_id: targetUserId,
        text: `${e("BAN", "🚫")} Your account has been permanently banned due to fraudulent slip submission.`,
        parse_mode: "HTML"
      });
      return;
    }
  }

  // --- D. USER INTERACTION NAVIGATION ---
  const user = await getOrCreateUser(env, cb.from);
  if (user.is_banned === 1) {
    await editMsg("🚫 <b>Account Suspended.</b>", { inline_keyboard: [] });
    return;
  }

  const balance = Number(user.balance || 0);

  // Return to Home
  if (data === "menu_home") {
    await env.DB.prepare("UPDATE users SET pending_topup_amount = 0 WHERE telegram_id = ?").bind(user.telegram_id).run();
    await editMsg(MSG.getWelcomeMessage(cb.from.first_name), KB.getMainKeyboard());
    return;
  }

  // Balance
  if (data === "menu_balance") {
    const spendRow = await env.DB.prepare(
      "SELECT COALESCE(SUM(price), 0) as total_spent FROM orders WHERE user_id = ?"
    ).bind(user.telegram_id).first();
    const totalSpent = Number(spentRow?.total_spent || 0);

    let lastDepositText ="No Deposit yet";
    if (user.last_topup_at) {
      try {
        const d = new Date(user.last_topup_at);
        lastDepositText = d.toLocaleString("en-GB", { timeZone: "Asia/Yangon" });
      } catch (e) {
        lastDepositText = user.last_topup_at;
      }
    }
    const balMsg = 
      `${e("BALANCE", "💵")} <b>Your Wallet Balance</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `<blockquote>` +
      `• ${e("PROFILE", "👤")} Account: <b>${cb.from.first_name || ""}</b>\n` +
      `• ${e("USER_ID", "🆔")} Telegram ID: <code>${user.telegram_id}</code>\n` +
      `</blockquote>\n\n` +
      `<blockquote>` +
      `• ${e("BALANCE", "💰")} Current Balance: <b>${balance.toLocaleString()} MMK</b>\n` +
      `• ${e("SHOP", "🛍")} Total Spent: <b>${totalSpent.toLocaleString()} MMK</b>\n` +
      `• ${e("TIME", "⏰")} Last Deposit: <i>${lastDepositText}</i>\n` +
      `</blockquote>\n\n` +
      `<i>Need more credits? Tap Deposit to top up your wallet.</i> ${e("DOWN", "👇")}`;
    await editMsg(balMsg, {
      inline_keyboard: [
        [makeBtn("Deposit", "callback_data", "menu_topup", null, "BTN_DEPOSIT")],
        [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
      ]
    });
    return;
  }

  // Profile Orders
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
    const regDate = user.created_at ? MSG.formatMyanmarTime(new Date(user.created_at.replace(" ", "T") + "Z")) : "N/A";

    let profMsg = 
      `${e("PROFILE", "👤")} <b>Your Account Profile</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `<blockquote>` +
      `• ${e("PROFILE", "👤")} Name: <b>${cb.from.first_name || ""}</b>\n` +
      `• ${e("USER_ID", "🆔")} User ID: <code>${user.telegram_id}</code>\n` +
      `• ${e("DATE", "📅")} Member Since: <b>${regDate}</b>` +
      `</blockquote>\n\n` +
      `<blockquote>` +
      `• ${e("BALANCE", "💰")} Balance: <b>${balance.toLocaleString()} MMK</b>\n` +
      `• ${e("STOCK", "📦")} Keys Purchased: <b>${totalOrders} keys</b>\n` +
      `</blockquote>\n\n` +
      `${e("KEY", "🔑")} <b>Your Purchased Keys:</b>\n`;

    if (orders.length === 0) {
      profMsg += `<i>(No keys purchased yet)</i>`;
    } else {
      profMsg += `<i>Tap any key below to view details and access key:</i>`;
    }

    await editMsg(profMsg, KB.getProfileOrdersKeyboard(orders, page, totalPages));
    return;
  }

  // Key Details Viewer
  if (data.startsWith("view_ord_")) {
    const parts = data.split("_");
    const orderId = parts[2];
    const returnPage = parts[3] || 1;

    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").bind(orderId, userId).first();

    if (!order) {
      await editMsg("⚠️ Key record not found.", {
        inline_keyboard: [[makeBtn("Back to List", "callback_data", `menu_profile_p_${returnPage || 1}`)]]
      });
      return;
    }

    const pkgInfo = CONFIG.PACKAGES[order.category] || { days: 30, gb: order.category };
    const buyDate = new Date(order.created_at.replace(" ", "T") + "Z");
    const expiryDate = new Date(buyDate.getTime() + pkgInfo.days * 24 * 60 * 60 * 1000);
    const now = new Date();

    let statusText = "";
    if (now > expiryDate) {
      statusText = `🔴 <b>Expired</b>`;
    } else {
      const diffMs = expiryDate - now;
      const leftDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const leftHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      statusText = `🟢 <b>Active (${leftDays}d ${leftHours}h remaining)</b>`;
    }

    const detailMsg = 
      `${e("STOCK", "📦")} <b>Order Details (#${order.id})</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `<blockquote>` +
      `• ${e("STAR", "💎")} <b>Plan:</b> ${pkgInfo.gb || order.category.toUpperCase()}\n` +
      `• ${e("BALANCE", "💰")} <b>Price:</b> ${order.price.toLocaleString()} MMK\n` +
      `• ${e("DATE", "📅")} <b>Purchased:</b> ${MSG.formatMyanmarTime(buyDate)}\n` +
      `• ${e("CLOCK", "⏳")} <b>Expires:</b> ${MSG.formatMyanmarTime(expiryDate)}\n` +
      `• ${e("STATUS", "📊")} <b>Status:</b> ${statusText}` +
      `</blockquote>\n\n` +
      `${e("KEY", "🔑")} <b>Outline Access Key:</b>\n` +
      `<code>${order.access_key}</code>\n\n` +
      `${e("UP", "👆")} <i>Tap the code above to copy to clipboard.</i>`;

    await editMsg(detailMsg, KB.getKeyDetailKeyboard(order.id, returnPage, order.access_key));
    return;
  }

  // Key Deletion Prompt
  if (data.startsWith("del_conf_")) {
    const [, , orderId, returnPage] = data.split("_");
    const warnMsg = 
      `${e("WARNING", "⚠️")} <b>Delete Confirmation</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `Are you sure you want to permanently delete Key (#${orderId}) from your profile history?\n\n` +
      `<i>(Notice: This action cannot be undone and your key will be removed permanently)</i>`;

    await editMsg(warnMsg, KB.getDeleteConfirmKeyboard(orderId, returnPage || 1));
    return;
  }

  // Key Deletion Execution
  if (data.startsWith("del_exec_")) {
    const [, , orderId, returnPage] = data.split("_");
    await env.DB.prepare("DELETE FROM orders WHERE id = ? AND user_id = ?").bind(orderId, userId).run();

    await tg(env, "answerCallbackQuery", {
      callback_query_id: callbackId,
      text: "🗑 Key deleted successfully from your history!",
      show_alert: true,
    });

    const finishMsg = 
      `${e("DONE", "✅")} <b>Key (#${orderId}) Removed!</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `The key has been permanently cleared from your account history.`;

    await editMsg(finishMsg, {
      inline_keyboard: [
        [makeBtn("Back to Profile", "callback_data", "menu_profile_p_1", null, "BTN_PROFILE")],
        [makeBtn("Main Menu", "callback_data", "menu_home", null, "BTN_HOME")]
      ]
    });
    return;
  }

  // Terms of Service
  if (data === "menu_terms") {
    const termsMsg = 
      `${e("TERMS", "📜")} <b>Terms of Service & Store Policies</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `Please read and understand our store policies before proceeding:\n\n` +
      `<blockquote>` +
      `1. <b>Strict No-Refund Policy:</b>\n` +
      `• All wallet top-ups and key purchases are final. Refunds will NOT be issued under any circumstances.\n\n` +
      `2. <b>Server Downtime & Support:</b>\n` +
      `• In case of server interruption or protocol blockages, our team will investigate and restore the access nodes within <b>24 hours</b>.\n\n` +
      `3. <b>Payment Note Instructions:</b>\n` +
      `• Strictly do <b>NOT</b> write "VPN", "Key", "Outline", or store-related words in the transaction note/remark when transferring via KPay or AYAPay.\n` +
      `• Any transaction violating this rule will be rejected immediately and balance will <b>NOT</b> be added.\n\n` +
      `4. <b>Fraud Prevention & Permanent Ban:</b>\n` +
      `• Submitting fake, altered, reused, or fraudulent transaction slips will lead to an immediate and permanent <b>Account & Telegram ID Ban</b> across all our bots and services.\n\n` +
      `5. <b>Fair Usage:</b>\n` +
      `• Purchased Outline keys are for single-device/personal use only. Reselling or public sharing is strictly prohibited.` +
      `</blockquote>\n\n` +
      `${e("WARNING", "⚠️")} <b>By using our bot and depositing funds, you fully agree to comply with all the terms above.</b>`;
    await editMsg(termsMsg, {
      inline_keyboard: [[makeBtn("Main Menu", "callback_data", "menu_home", null, "BTN_HOME")]]
    });
    return;
  }

  // Deposit Menu
  if (data === "menu_topup") {
    const topupSelectMsg = 
      `${e("DEPOSIT", "💳")} <b>Select Deposit Amount</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `Select your desired deposit amount below or enter a custom sum:`;
    await editMsg(topupSelectMsg, KB.getTopupKeyboard());
    return;
  }

  // Custom Topup Entry Prompt
  if (data === "topup_custom") {
    await env.DB.prepare("UPDATE users SET pending_topup_amount = -1 WHERE telegram_id = ?").bind(userId).run();
    const customPromptMsg = 
      `${e("CUSTOM", "✍️")} <b>Enter Custom Amount</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `Type the amount you wish to deposit in digits and send it into this chat:\n\n` +
      `• Minimum Deposit: <b>${CONFIG.PAYMENT.MIN_TOPUP.toLocaleString()} MMK</b>\n` +
      `• Examples: <code>2500</code>, <code>5000</code> or <code>20000</code>`;

    await editMsg(customPromptMsg, {
      inline_keyboard: [[makeBtn("Deposit", "callback_data", "menu_topup", null, "BTN_DEPOSIT")]]
    });
    return;
  }

  // Standard Topup Selected
  if (data.startsWith("topup_amt_")) {
    const amount = Number(data.replace("topup_amt_", ""));
    await env.DB.prepare("UPDATE users SET pending_topup_amount = ? WHERE telegram_id = ?").bind(amount, userId).run();

    await editMsg(MSG.getPaymentInfoMessage(amount), {
      inline_keyboard: [[makeBtn("Change Amount", "callback_data", "menu_topup", null, "BTN_CUSTOM")]]
    });
    return;
  }

  // Buy Menu
  if (data === "menu_buy") {
    await editMsg(MSG.getPackageListMessage(balance), KB.getBuyPackagesKeyboard());
    return;
  }

  // Key Purchasing Transaction
  if (data.startsWith("buy_pkg_")) {
    const [, , category, priceStr] = data.split("_");
    const price = Number(priceStr);

    if (balance < price) {
      await editMsg(
        `${e("UNSTOCK", "😔")} <b>Insufficient Wallet Balance!</b>\n` +
        `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
        `• Plan Price: <b>${price.toLocaleString()} MMK</b>\n` +
        `• Your Balance: <b>${balance.toLocaleString()} MMK</b>\n\n` +
        `Please top up your wallet balance to complete this purchase.`,
        {
          inline_keyboard: [
            [makeBtn("Deposit Fund", "callback_data", "menu_topup", null, "BTN_DEPOSIT")],
            [makeBtn("Back to Plans", "callback_data", "menu_buy", null, "BTN_SHOP")]
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
        `${e("UNSTOCK", "😔")} <b>Stock Unavailable!</b>\n` +
        `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
        `We are currently out of stock for <b>[${category.toUpperCase()}]</b>. Admin has been notified to restock immediately.`,
        {
          inline_keyboard: [
            [makeBtn("Back to Plans", "callback_data", "menu_buy", null, "BTN_SHOP")],
            [makeBtn("Contact Support", "url", `https://t.me/${CONFIG.ADMIN_USERNAME}`, null, "BTN_SUPPORT")]
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

    await editMsg(MSG.getKeyDeliveryMessage(category, price, keyItem.access_key), {
      inline_keyboard: [
        [makeBtn("View in Profile", "callback_data", "menu_profile_p_1", null, "BTN_PROFILE")],
        [makeBtn("Join Sales Proof", "url", `https://t.me/sales_proved`, null, "BTN_ANNOUNCE")],
        [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
      ]
    });

    const salesChannelId = String(env.SALES_CHANNEL_ID || "").trim();
    if (salesChannelId) {
      try {
        await tg(env, "sendMessage", {
          chat_id: salesChannelId,
          text: MSG.getChannelSaleMessage(cb.from.first_name, category, price, keyItem.access_key),
          parse_mode: "HTML",
          reply_markup: KB.getSalesChannelKeyboard()
        });
      } catch (err) {
        console.error("Sales Channel notification failed:", err);
      }
    }
    return;
  }

  // Test Key Info Page
  if (data === "menu_test_key_info") {
    if (user.last_claimed_test_at && user.current_test_key) {
      const lastClaim = new Date(user.last_claimed_test_at.replace(" ", "T") + "Z");
      const nextDate = new Date(lastClaim.getTime() + 30 * 24 * 60 * 60 * 1000);
      const now = new Date();

      if (now < nextDate) {
        const remainingMs = nextDate - now;
        const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        await editMsg(
          `${e("WARNING", "⚠️")} <b>Test Key Already Claimed!</b>\n` +
          `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
          `<blockquote>` +
          `• ${e("DATE", "📅")} Claimed On: <b>${MSG.formatMyanmarTime(lastClaim)}</b>\n` +
          `• ${e("CLOCK", "⏳")} Next Available: <b>${MSG.formatMyanmarTime(nextDate)}</b>` +
          `</blockquote>\n\n` +
          `<i>You can claim another test key in <b>${days} days and ${hours} hours</b>.</i>`,
          {
            inline_keyboard: [
              [makeBtn("View My Test Key", "callback_data", "view_claimed_test_key", null, "BTN_KEY")],
              [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
            ]
          }
        );
        return;
      }
    }

    await editMsg(MSG.getTestKeyInfoMessage(), {
      inline_keyboard: [
        [makeBtn("Claim Free Test Key", "callback_data", "exec_claim_test_key", null, "BTN_FREEBIES")],
        [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
      ]
    });
    return;
  }

  // Claim Test Key Execution
  if (data === "exec_claim_test_key") {
    const testKeyItem = await env.DB.prepare(
      "SELECT id, access_key FROM keys WHERE category = 'test' LIMIT 1"
    ).first();

    if (!testKeyItem) {
      await editMsg(
        `${e("UNSTOCK", "😔")} <b>Out of Stock!</b>\nNo free test keys are currently available in the pool. Please check back soon.`,
        {
          inline_keyboard: [
            [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")],
            [makeBtn("Contact Support", "url", `https://t.me/${CONFIG.ADMIN_USERNAME}`, null, "BTN_SUPPORT")]
          ]
        }
      );
      return;
    }

    await editMsg(
      `${e("SUCCESS", "🎉")} <b>Your Free Test Key is Ready!</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `${e("KEY", "🔑")} <b>Access Key:</b>\n` +
      `<code>${testKeyItem.access_key}</code>\n\n` +
      `${e("DOWN", "👇")} <i>Tap the copy button below or tap the code to copy ${e("KEY", "🔑")} Test Key.</i>`,
      KB.getTestKeyActionKeyboard(testKeyItem.access_key)
    );
    return;
  }

  // View Existing Test Key
  if (data === "view_claimed_test_key") {
    const keyStr = user.current_test_key || "Key record not found.";
    await editMsg(
      `${e("KEY", "🔑")} <b>Your Active Free Test Key</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `<code>${keyStr}</code>\n\n` +
      `${e("DOWN", "👇")} <i>Tap the copy button below or tap the code to copy ${e("KEY", "🔑")} Test Key.</i>`,
      KB.getTestKeyActionKeyboard(keyStr)
    );
    return;
  }
}
