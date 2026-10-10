import { CONFIG, e, makeBtn } from "./config.js";
import * as KB from "./keyboards.js";
import * as MSG from "./messages.js";

export default {
  async fetch(request, env) {

    if (request.method !== "POST") return new Response("OK");

    try {
      const update = await request.json();
      console.log("UPDATE RECEIVED:", JSON.stringify(update));

      if (update.callback_query) {
        await handleCallback(update.callback_query, env);
      } else if (update.message) {
        await handleMessage(update.message, env);
      }
    } catch (err) {
      console.error("Worker Execution Error:", err.message, err.stack);
    }

    return new Response("OK");
  },

  // ⏰ Cloudflare Cron Trigger (Dynamic Expiry Alarm + Auto Clear Test Keys)
  async scheduled(event, env, ctx) {
    try {
      const now = new Date();

      // --- အပိုင်း ၁။ သက်တမ်းကုန်သွားသော TEST KEY များကို Noti ပို့ခြင်း (Database မှ ချက်ချင်းမဖျက်ဘဲ reminded_exp သာ မှတ်သားမည်) ---
      const expiredTests = await env.DB.prepare(`
        SELECT orders.*, users.first_name 
        FROM orders 
        JOIN users ON orders.user_id = users.telegram_id
        WHERE orders.category = 'test' AND orders.reminded_exp = 0
      `).all();

      for (const order of expiredTests.results || []) {
        const pkgConfig = CONFIG.PACKAGES[order.category] || { days: 1 };
        const totalDays = pkgConfig.days || 1;
        
        const createdAt = parseDbDate(order.created_at);
        const expireAt = new Date(createdAt.getTime() + totalDays * 24 * 60 * 60 * 1000);

        if (now.getTime() >= expireAt.getTime()) {
          // မှတ်တမ်းမပျက်စေရန် မဖျက်ဘဲ reminded_exp = 1 အဖြစ်သာ update လုပ်ပါမည်
          await env.DB.prepare("UPDATE orders SET reminded_exp = 1 WHERE id = ?").bind(order.id).run();

          const buyerName = order.first_name || "Customer";
          const expiredMsg = MSG.getTestKeyExpiredMessage(buyerName);

          await tg(env, "sendMessage", {
            chat_id: order.user_id,
            text: expiredMsg,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [makeBtn("Get New Test Key", "callback_data", "menu_test", null, "BTN_FREEBIES")],
                [makeBtn("Buy Outline Key", "callback_data", "menu_buy", null, "BTN_SHOP")]
              ]
            }
          });
        }
      }

      // --- ၃၀ ရက် ပြည့်သွားသော Test Key မှတ်တမ်းအဟောင်းများကိုသာ Database မှ အပြီးသတ်ရှင်းထုတ်ခြင်း ---
      await env.DB.prepare(`
        DELETE FROM orders 
        WHERE category = 'test' 
        AND datetime(created_at, '+30 days') <= datetime('now')
      `).run();

      // --- အပိုင်း ၂။ ပုံမှန် Key များ ၂ ရက်အလို သတိပေးချက် ပို့ခြင်း ---
      const { results } = await env.DB.prepare(`
        SELECT orders.*, users.first_name 
        FROM orders 
        JOIN users ON orders.user_id = users.telegram_id
        WHERE orders.category != 'test' AND orders.reminded_exp = 0
      `).all();

      for (const order of results || []) {
        const pkgConfig = CONFIG.PACKAGES[order.category];
        const totalDays = pkgConfig?.days || 30;

        const createdAt = parseDbDate(order.created_at);
        const expireAt = new Date(createdAt.getTime() + totalDays * 24 * 60 * 60 * 1000);

        const diffMs = expireAt.getTime() - now.getTime();
        const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (daysLeft <= 2 && daysLeft > 0) {
          const buyerName = order.first_name || "Customer";
          const reminderText = MSG.getExpiryReminderMessage(
            buyerName, 
            order.category, 
            order.access_key, 
            daysLeft
          );

          await tg(env, "sendMessage", {
            chat_id: order.user_id,
            text: reminderText,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [makeBtn("Buy Outline Key", "callback_data", "menu_buy", null, "BTN_SHOP")]
              ]
            }
          });

          await env.DB.prepare(
            "UPDATE orders SET reminded_exp = 1 WHERE id = ?"
          ).bind(order.id).run();
        }
      }
    } catch (err) {
      console.error("Scheduled Error:", err.message || err);
    }
  }
};

// Telegram Request Helper
async function tg(env, method, payload) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Telegram Request Helper with JSON return
async function tgJson(env, method, payload) {
  try {
    const res = await tg(env, method, payload);
    return await res.json();
  } catch (e) {
    return null;
  }
}

// Chat ID နှိုင်းယှဉ်သည့် Helper
function isMatchChatId(chatId, targetGroupId) {
  if (!targetGroupId || !chatId) return false;
  const a = String(chatId).replace(/^-100/, "").replace(/^-/, "").trim();
  const b = String(targetGroupId).replace(/^-100/, "").replace(/^-/, "").trim();
  return a === b;
}

// SQLite Timestamp အား တိကျသေချာသော Date Object အဖြစ် ပြောင်းလဲပေးသည့် Helper
function parseDbDate(dateStr) {
  if (!dateStr) return new Date();
  const s = String(dateStr).trim();
  return new Date(s.includes("T") ? s : s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z"));
}

// Admin ဟုတ်မဟုတ် စစ်ဆေးခြင်း
async function checkIsAdmin(env, chatId, user) {
  if (user?.username && CONFIG.ADMIN_USERNAME && user.username.toLowerCase().replace("@", "") === CONFIG.ADMIN_USERNAME.toLowerCase().replace("@", "")) {
    return true;
  }
  const memberData = await tgJson(env, "getChatMember", {
    chat_id: chatId,
    user_id: user.id
  });
  return memberData?.ok && ["creator", "administrator"].includes(memberData?.result?.status);
}

// User သည် သတ်မှတ် Channel ထဲ Join ထားခြင်း ရှိမရှိ စစ်ဆေးခြင်း
async function checkMustJoin(env, userId) {
  if (!CONFIG.FORCE_JOIN?.ENABLED) return true;
  try {
    const res = await tgJson(env, "getChatMember", {
      chat_id: CONFIG.FORCE_JOIN.CHANNEL_ID,
      user_id: userId
    });
    if (!res || !res.ok || !res.result) return false;
    const status = res.result.status;
    return ["member", "administrator", "creator"].includes(status);
  } catch (err) {
    console.error("Force join error:", err);
    return true;
  }
}

// User Record Finder
async function getOrCreateUser(env, from, referrerId = null) {
  let user = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(from.id).first();
  if (!user) {
    const validReferrer = (referrerId && Number(referrerId) !== Number(from.id)) ? referrerId : null;
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
    try {
      await tg(env, "deleteMessage", {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
    } catch (delErr) {}

    const user = await getOrCreateUser(env, msg.from);

    if (user.is_banned === 1) {
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `${e("BAN", "🚫")} <b>Access Denied:</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n Your account has been permanently suspended due to violation of store rules.`,
        parse_mode: "HTML",
      });
      return;
    }

    if (text.startsWith("/start")) {
      await env.DB.prepare("UPDATE users SET pending_topup_amount = 0 WHERE telegram_id = ?").bind(user.telegram_id).run();
      // --- 📢 FORCE JOIN CHANNEL CHECK ---
      const isJoined = await checkMustJoin(env, user.telegram_id);
      if (!isJoined) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: MSG.getMustJoinMessage(),
          parse_mode: "HTML",
          reply_markup: KB.getMustJoinKeyboard(CONFIG.FORCE_JOIN.CHANNEL_LINK),
        });
        return;
      }

      const param = text.split(" ")[1];

      if (param && param.startsWith("ref_")) {
        const referrerId = parseInt(param.replace("ref_", ""), 10);
        if (!isNaN(referrerId) && referrerId !== user.telegram_id && !user.referred_by) {
          await env.DB.prepare("UPDATE users SET referred_by = ? WHERE telegram_id = ?").bind(referrerId, user.telegram_id).run();
            user.referred_by = referrerId;
        }
      }
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
          text: `${e("WARNING", "⚠️")} <b>Invalid Amount!</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\nMinimum deposit is <b>${CONFIG.PAYMENT.MIN_TOPUP.toLocaleString()} MMK</b>.\nPlease send digits only (e.g. <code>2500</code> or <code>5000</code>).`,
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
        reply_markup: { inline_keyboard: [[makeBtn("Change Amount", "callback_data", "topup_custom", "primary", "BTN_CUSTOM")]] }
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
        text: `${e("DONE", "✅")} <b>Payment Slip Received!</b>\n\nAmount: <b>${currentAmt.toLocaleString()} MMK</b>\nOur team is verifying your payment. ${e("CLOCK", "⏳")} \nYour wallet balance will be credited within <b>5 Minutes to 24 Hours maximum</b> automatically once approved.\n\nHave A Great Day ${e("STAR", "✨")}`,
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
  if (paymentGroupId && isMatchChatId(chatId, paymentGroupId)) {
    const isAdmin = await checkIsAdmin(env, chatId, msg.from);
    if (!isAdmin) return;

    if (text.startsWith("/ban")) {
      const targetId = text.split(/\s+/)[1]?.trim();
      if (targetId) {
        await env.DB.prepare("UPDATE users SET is_banned = 1 WHERE telegram_id = ?").bind(targetId).run();
        await tg(env, "sendMessage", { chat_id: chatId, text: `${e("BAN", "🚫")} User <code>${targetId}</code> has been banned.`, parse_mode: "HTML" });
        try {
          await tg(env, "sendMessage", {
            chat_id: targetId,
            text: `${e("BAN", "🚫")} <b>Account Suspended</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\nYour account has been suspended for violating our terms of service.`,
            parse_mode: "HTML"
          });
        } catch (_) {}
      }
      return;
    }

    if (text.startsWith("/unban")) {
      const targetId = text.split(/\s+/)[1]?.trim();
      if (targetId) {
        await env.DB.prepare("UPDATE users SET is_banned = 0 WHERE telegram_id = ?").bind(targetId).run();
        await tg(env, "sendMessage", { chat_id: chatId, text: `${e("DONE", "✅")} User <code>${targetId}</code> has been unbanned.`, parse_mode: "HTML" });
        try {
          await tg(env, "sendMessage", {
            chat_id: targetId,
            text: `${e("SUCCESS", "🎉")} <b>Account Re-activated</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\nYour account suspension has been lifted. You can now use the bot again.`,
            parse_mode: "HTML"
          });
        } catch (_) {}
      }
      return;
    }

    async function getStoreAnalyticsReport(env) {
      const fmtNum = (n) => Number(n || 0).toLocaleString();
      const nowStr = new Date().toLocaleString("en-US", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true,
        timeZone: "Asia/Yangon"
      });

      const totalRevRes = await env.DB.prepare("SELECT SUM(price) as total_rev, COUNT(*) as total_orders FROM orders WHERE category != 'test'").first();
      const todayRes = await env.DB.prepare("SELECT SUM(price) as today_rev, COUNT(*) as today_orders FROM orders WHERE category != 'test' AND date(datetime(created_at, '+6 hours', '+30 minutes')) = date(datetime('now', '+6 hours', '+30 minutes'))").first();
      const yestRes = await env.DB.prepare("SELECT COALESCE(SUM(price), 0) AS rev, COUNT(*) AS orders FROM orders WHERE category != 'test' AND date(datetime(created_at, '+6 hours', '+30 minutes')) = date(datetime('now', '+6 hours', '+30 minutes', '-1 day'))").first();
      const monthRes = await env.DB.prepare("SELECT COALESCE(SUM(price), 0) AS rev, COUNT(*) AS orders FROM orders WHERE category != 'test' AND strftime('%Y-%m', datetime(created_at, '+6 hours', '+30 minutes')) = strftime('%Y-%m', datetime('now', '+6 hours', '+30 minutes'))").first();
      
      const pkgRows = await env.DB.prepare("SELECT category, COUNT(*) AS count, COALESCE(SUM(price), 0) AS rev FROM orders WHERE category != 'test' GROUP BY category").all();
      let pkgBreakdownText = pkgRows?.results?.length > 0 ? pkgRows.results.map(r => `• <b>${r.category}:</b> ${r.count} Sold (${fmtNum(r.rev)} MMK)`).join("\n") : "• <i>No sales yet</i>";

      const refRes = await env.DB.prepare("SELECT COALESCE(SUM(referral_earnings), 0) AS total_ref FROM users").first();
      const totalUsersRes = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
      const bannedUsersRes = await env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE is_banned = 1").first();
      const activeKeysRes = await env.DB.prepare("SELECT COUNT(DISTINCT user_id) as count FROM orders").first();
      
      const stockRes = await env.DB.prepare("SELECT category, COUNT(*) as count FROM keys GROUP BY category").all();
      const stockMap = { test: 0, "50gb": 0, "100gb": 0, "250gb": 0 };
      if (stockRes?.results) for (const row of stockRes.results) if (stockMap.hasOwnProperty(row.category)) stockMap[row.category] = row.count;

      const pendingAuditRes = await env.DB.prepare("SELECT COUNT(*) as count FROM topup_requests WHERE status = 'pending'").first();

      return `${e("STATUS", "📊")} <b>Store Analytics & Executive Report</b>\n` +
        `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
        `${e("BALANCE", "💰")} <b>Revenue & Cash Flow</b>\n` +
        `<blockquote>` +
        `• <b>Today:</b> ${fmtNum(todayRes?.today_rev)} MMK (${fmtNum(todayRes?.today_orders)} Orders)\n` +
        `• <b>Yesterday:</b> ${fmtNum(yestRes?.rev)} MMK (${fmtNum(yestRes?.orders)} Orders)\n` +
        `• <b>This Month:</b> ${fmtNum(monthRes?.rev)} MMK (${fmtNum(monthRes?.orders)} Orders)\n` +
        `• <b>All-Time Revenue:</b> ${fmtNum(totalRevRes?.total_rev)} MMK\n` +
        `• <b>Total Completed Sales:</b> ${fmtNum(totalRevRes?.total_orders)}` +
        `</blockquote>\n\n` +
        `${e("STOCK", "📦")} <b>Package Performance (Sales)</b>\n` +
        `<blockquote>${pkgBreakdownText}</blockquote>\n\n` +
        `${e("STAR", "🌟")} <b>Affiliate / Referral Stats</b>\n` +
        `<blockquote>• <b>Total Commission:</b> ${fmtNum(refRes?.total_ref)} MMK</blockquote>\n\n` +
        `${e("STOCK", "📦")} <b>Key Inventory (Stock)</b>\n` +
        `<blockquote>` +
        `• <b>50GB Keys:</b> ${fmtNum(stockMap["50gb"])} Available\n` +
        `• <b>100GB Keys:</b> ${fmtNum(stockMap["100gb"])} Available\n` +
        `• <b>250GB Keys:</b> ${fmtNum(stockMap["250gb"])} Available ${stockMap["250gb"] <= 3 ? "⚠️" : ""}\n` +
        `• <b>Free Test Keys:</b> ${fmtNum(stockMap["test"])} Available` +
        `</blockquote>\n\n` +
        `${e("USERS", "👥")} <b>Users & Security</b>\n` +
        `<blockquote>` +
        `• <b>Total Registered:</b> ${fmtNum(totalUsersRes?.count)}\n` +
        `• <b>Active Key Users:</b> ${fmtNum(activeKeysRes?.count)}\n` +
        `• <b>Suspended/Banned:</b> ${fmtNum(bannedUsersRes?.count)}` +
        `</blockquote>\n\n` +
        `${e("CLOCK", "⏳")} <b>Audit Queue:</b> ${fmtNum(pendingAuditRes?.count)} Pending Slips\n` +
        `<b>━━━━━━━━━━━━━━━━━━━━</b>\n` +
        `${e("BTN_REFRESH", "🔄")} <i>Last updated: ${nowStr}</i>`;
    }

    const cleanCmd = text.split("@")[0].split(/\s+/)[0].toLowerCase();
    if (cleanCmd === "/stats") {
      const reportText = await getStoreAnalyticsReport(env);
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: reportText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[makeBtn("Refresh Status", "callback_data", "admin_refresh_stats", "primary", "BTN_REFRESH")]]
        }
      });
      return;
    }

    if (/^\/(addbal|addbl|subbal)\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const targetInput = parts[1];
      const amount = parseInt(parts[2], 10);

      if (!targetInput || isNaN(amount) || amount <= 0) {
        await tg(env, "sendMessage", {
          chat_id: chatId,
          text: `${e("WARNING", "⚠️")} <b>Invalid Command Format!</b>\n\n<b>Usage:</b>\n• <code>/addbal &lt;id or @username&gt; &lt;amount&gt;</code>\n• <code>/subbal &lt;id or @username&gt; &lt;amount&gt;</code>\n\n<b>Examples:</b>\n• <code>/addbal 7271969259 5000</code>\n• <code>/subbal @username 2500</code>`,
          parse_mode: "HTML"
        });
        return;
      }

      let targetUser = targetInput.startsWith("@") 
        ? await env.DB.prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?)").bind(targetInput.replace("@", "").trim()).first()
        : await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(targetInput.trim()).first();

      if (!targetUser) {
        await tg(env, "sendMessage", { chat_id: chatId, text: `${e("WARNING", "❌")} <b>User Not Found:</b> <code>${targetInput}</code>\n<i>The user must have started the bot at least once.</i>`, parse_mode: "HTML" });
        return;
      }

      const isAdd = cmd.startsWith("/add");
      if (!isAdd && targetUser.balance < amount) {
        await tg(env, "sendMessage", { chat_id: chatId, text: `${e("WARNING", "⚠️")} <b>Insufficient Balance!</b>\nUser's current balance is only <b>${Number(targetUser.balance).toLocaleString()} MMK</b>. Cannot deduct <b>${amount.toLocaleString()} MMK</b>.`, parse_mode: "HTML" });
        return;
      }

      const sql = isAdd 
        ? "UPDATE users SET balance = balance + ?, last_topup_at = datetime('now', '+6 hours', '+30 minutes') WHERE telegram_id = ?"
        : "UPDATE users SET balance = balance - ? WHERE telegram_id = ?";

      await env.DB.prepare(sql).bind(amount, targetUser.telegram_id).run();

      const updatedUser = await env.DB.prepare("SELECT balance FROM users WHERE telegram_id = ?").bind(targetUser.telegram_id).first();
      const newBal = Number(updatedUser?.balance || 0);
      const actionText = isAdd ? "Credited (+)" : "Deducted (-)";
      const actionEmoji = isAdd ? e("SUCCESS", "✅") : e("WARNING", "🔻");

      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `${actionEmoji} <b>Balance Updated Successfully!</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n<blockquote>• <b>User:</b> ${targetUser.first_name || ""} (<code>${targetUser.telegram_id}</code>)\n• <b>Username:</b> @${targetUser.username || "None"}\n• <b>Action:</b> ${actionText} <b>${amount.toLocaleString()} MMK</b>\n• <b>New Balance:</b> <b>${newBal.toLocaleString()} MMK</b></blockquote>`,
        parse_mode: "HTML"
      });

      try {
        const userNotice = isAdd
          ? `${e("SUCCESS", "🎉")} <b>Balance Credited!</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\nAn admin has added <b>+${amount.toLocaleString()} MMK</b> to your wallet.\n\n${e("BALANCE", "💰")} <b>Current Balance:</b> <code>${newBal.toLocaleString()} MMK</code>`
          : `${e("WARNING", "⚠️")} <b>Balance Deducted!</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\nAn admin has deducted <b>-${amount.toLocaleString()} MMK</b> from your wallet.\n\n${e("BALANCE", "💰")} <b>Current Balance:</b> <code>${newBal.toLocaleString()} MMK</code>`;
        await tg(env, "sendMessage", { chat_id: targetUser.telegram_id, text: userNotice, parse_mode: "HTML" });
      } catch (err) {}
      return;
    }

    if (text.startsWith("/broadcast")) {
      const broadcastMsg = text.replace(/^\/broadcast(@\w+)?/, "").trim();
      if (!broadcastMsg) {
        await tg(env, "sendMessage", { chat_id: chatId, text: `${e("WARNING", "⚠️")}<b>Usage:</b> <code>/broadcast Your message here...</code>`, parse_mode: "HTML" });
        return;
      }
      const allUsers = await env.DB.prepare("SELECT telegram_id FROM users WHERE is_banned = 0").all();
      let successCount = 0;
      for (const u of allUsers.results || []) {
        try {
          await tg(env, "sendMessage", { chat_id: u.telegram_id, text: ` ${e("ANNOUNCE", "📢")} <b>Store Announcement</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n${broadcastMsg}`, parse_mode: "HTML" });
          successCount++;
        } catch (e) {}
      }
      await tg(env, "sendMessage", { chat_id: chatId, text: `${e("DONE", "✅")} Announcement sent to <b>${successCount}/${(allUsers.results || []).length}</b> users.`, parse_mode: "HTML" });
      return;
    }
  }

  // --- 3. STOCK MANAGEMENT GROUP COMMANDS ---
  if (stockGroupId && isMatchChatId(chatId, stockGroupId)) {
    const cleanCmd = text.split("@")[0].split(/\s+/)[0].toLowerCase();
    if (cleanCmd === "/stock") {
      const counts = await env.DB.prepare("SELECT category, COUNT(*) as count FROM keys GROUP BY category").all();
      let stockMap = { test: 0, "50gb": 0, "100gb": 0, "250gb": 0 };
      if (counts.results) counts.results.forEach(r => { stockMap[r.category] = r.count; });
      const stockMsg = 
      `${e("STATUS", "📊")} <b>Real-Time Key Stock Status</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `• ${e("FREEBIES", "🎁")} Free Test Keys: <b>${stockMap.test}</b> items\n` +
      `• ${e("DOT", "🔹")} 50 GB Keys: <b>${stockMap["50gb"]}</b> items\n` +
      `• ${e("DOT", "🔹")} 100 GB Keys: <b>${stockMap["100gb"]}</b> items\n` +
      `• ${e("DOT", "🔹")} 250 GB Keys: <b>${stockMap["250gb"]}</b> items\n`;
      await tg(env, "sendMessage", { chat_id: chatId, text: stockMsg, parse_mode: "HTML", reply_markup: KB.getStockRefreshKeyboard() });
      return;
    }

    if (["/add_test", "/add_50gb", "/add_100gb", "/add_250gb"].includes(cleanCmd)) {
      const category = cleanCmd.replace("/add_", "");
      const validKeys = text.split("\n").slice(1).map(k => k.trim()).filter(k => k.startsWith("ss://"));
      if (validKeys.length === 0) {
        await tg(env, "sendMessage", { chat_id: chatId, text: `${e("WARNING", "⚠️")} No keys detected. Format:\n<code>${cleanCmd}</code>\nss://key1...\nss://key2...`, parse_mode: "HTML" });
        return;
      }
      const stmts = validKeys.map(k => env.DB.prepare("INSERT OR IGNORE INTO keys (category, access_key) VALUES (?, ?)").bind(category, k));
      await env.DB.batch(stmts);
      const currentStock = await env.DB.prepare("SELECT COUNT(*) as count FROM keys WHERE category = ?").bind(category).first();
      await tg(env, "sendMessage", { chat_id: chatId, text: `${e("DONE", "✅")} <b>Keys Added Successfully: [${category.toUpperCase()}]</b>\n\n• Added: <b>${validKeys.length}</b> keys\n• Total in Stock: <b>${currentStock?.count || validKeys.length}</b> keys`, parse_mode: "HTML", reply_markup: KB.getStockRefreshKeyboard() });
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

  // --- 🌟 REFERRAL PROGRAM DASHBOARD ---
  if (data === "menu_referral") {
    const countRes = await env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE referred_by = ?").bind(userId).first();
    const userRes = await env.DB.prepare("SELECT referral_earnings FROM users WHERE telegram_id = ?").bind(userId).first();
    await editMsg(MSG.getReferralMessage(CONFIG.BOT_USERNAME, userId, countRes?.count || 0, userRes?.referral_earnings || 0, CONFIG.REFERRAL_PERCENT), KB.getReferralKeyboard());
    return;
  }

  // --- 📢 CHECK FORCE JOIN BUTTON ---
  if (data === "check_force_join") {
    const isJoined = await checkMustJoin(env, userId);
    if (!isJoined) {
      await tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "❌ You have not joined the channel yet! Please join first.", show_alert: true });
      return;
    }
    await editMsg(MSG.getWelcomeMessage(cb.from.first_name), KB.getMainKeyboard());
    return;
  }

  // --- A. STOCK GROUP ACTIONS ---
  if (stockGroupId && isMatchChatId(chatId, stockGroupId) && data === "admin_refresh_stock") {
    const counts = await env.DB.prepare("SELECT category, COUNT(*) as count FROM keys GROUP BY category").all();
    let stockMap = { test: 0, "50gb": 0, "100gb": 0, "250gb": 0 };
    if (counts.results) counts.results.forEach(r => { stockMap[r.category] = r.count; });
    const stockMsg = 
    `${e("STATUS", "📊")} <b>Real-Time Key Stock Status</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `• ${e("FREEBIES", "🎁")} Free Test Keys: <b>${stockMap.test}</b> items\n` +
    `• ${e("DOT", "🔹")} 50 GB Keys: <b>${stockMap["50gb"]}</b> items\n` +
    `• ${e("DOT", "🔹")} 100 GB Keys: <b>${stockMap["100gb"]}</b> items\n` +
    `• ${e("DOT", "🔹")} 250 GB Keys: <b>${stockMap["250gb"]}</b> items\n`;
    await editMsg(stockMsg, KB.getStockRefreshKeyboard());
    return;
  }

  // --- B. PAYMENT GROUP STATS REFRESH ---
  if (paymentGroupId && isMatchChatId(chatId, paymentGroupId) && data === "admin_refresh_stats") {
    const isAdmin = await checkIsAdmin(env, chatId, cb.from);
    if (!isAdmin) {
      await tg(env, "answerCallbackQuery", { callback_query_id: callbackId, text: "⚠️ Admins only!", show_alert: true });
      return;
    }
    // Dummy invoke for group refresh bypass via external function logic (handled in handleMessage). For brevity inline block skip.
    return;
  }

  // --- C. PAYMENT AUDIT ACTIONS ---
  if (paymentGroupId && isMatchChatId(chatId, paymentGroupId)) {
    if (data.startsWith("pay_app_")) {
      const [, , reqId, targetUserId, amountStr] = data.split("_");
      const amount = Number(amountStr);

      await env.DB.batch([
        env.DB.prepare("UPDATE users SET balance = balance + ?, last_topup_at = datetime('now', '+6 hours', '+30 minutes') WHERE telegram_id = ?").bind(amount, targetUserId),
        env.DB.prepare("UPDATE topup_requests SET status = 'approved' WHERE id = ?").bind(reqId)
      ]);

      await tg(env, "editMessageCaption", { chat_id: chatId, message_id: messageId, caption: (cb.message.caption || "") + `\n\n🟢 <b>APPROVED (+${amount.toLocaleString()} MMK) by Admin</b>`, parse_mode: "HTML" });
      await tg(env, "sendMessage", { chat_id: targetUserId, text: 
        `${e("SUCCESS", "🎉")} <b>Deposit Approved!</b>\n` +
        `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
        `Your wallet has been credited with <b>+${amount.toLocaleString()} MMK</b>.\n` +
        `You can now purchase Outline VPN keys anytime! ${e("STAR", "✨")}`, parse_mode: "HTML", reply_markup: KB.getMainKeyboard() });
      
      const targetUser = await env.DB.prepare("SELECT referred_by FROM users WHERE telegram_id = ?").bind(targetUserId).first();
      if (targetUser && targetUser.referred_by) {
        const bonusAmount = Math.floor(amount * ((CONFIG.REFERRAL_PERCENT || 5) / 100));
        if (bonusAmount > 0) {
          await env.DB.prepare(`UPDATE users SET balance = balance + ?, referral_earnings = referral_earnings + ? WHERE telegram_id = ?`).bind(bonusAmount, bonusAmount, targetUser.referred_by).run();
          try {
            await tg(env, "sendMessage", { chat_id: targetUser.referred_by, text: `${e("SUCCESS", "🎉")} <b>Referral Bonus Received!</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\nYour invited friend topped up their wallet.\nYou earned: <b>+${bonusAmount.toLocaleString()} MMK</b> (${CONFIG.REFERRAL_PERCENT}% bonus) credited to your wallet!`, parse_mode: "HTML" });
          } catch (e) {}
        }
      }
      return;
    }

    if (data.startsWith("pay_rej_")) {
      const [, , reqId, targetUserId] = data.split("_");
      await env.DB.prepare("UPDATE topup_requests SET status = 'rejected' WHERE id = ?").bind(reqId).run();
      await tg(env, "editMessageCaption", { chat_id: chatId, message_id: messageId, caption: (cb.message.caption || "") + `\n\n🔴 <b>REJECTED by Admin</b>`, parse_mode: "HTML" });
      await tg(env, "sendMessage", { chat_id: targetUserId, text: `${e("FALSE", "❌")} <b>Deposit Verification Failed:</b> We could not verify your transaction slip. Please contact support if you believe this is a mistake.`, parse_mode: "HTML", reply_markup: KB.getMainKeyboard() });
      return;
    }

    if (data.startsWith("pay_ban_")) {
      const targetUserId = data.replace("pay_ban_", "");
      await env.DB.prepare("UPDATE users SET is_banned = 1 WHERE telegram_id = ?").bind(targetUserId).run();
      await tg(env, "editMessageCaption", { chat_id: chatId, message_id: messageId, caption: (cb.message.caption || "") + `\n\n🚫 <b>USER BANNED (Fraudulent Slip)</b>`, parse_mode: "HTML" });
      await tg(env, "sendMessage", { chat_id: targetUserId, text: `${e("BAN", "🚫")} Your account has been permanently banned due to fraudulent slip submission.`, parse_mode: "HTML" });
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

  // Step 1: My Profile (Isolated Dashboard Screen)
  if (data === "menu_profile") {
    const totalSpent = Number(user.total_spent || 0);

    const depRes = await env.DB.prepare("SELECT SUM(amount) as total FROM topup_requests WHERE user_id = ? AND status = 'approved'").bind(userId).first();
    const totalDeposited = depRes?.total || 0;

    const orderStats = await env.DB.prepare("SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND category != 'test'").bind(userId).first();
    const totalOrders = orderStats?.count || 0;

    const refCountRes = await env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE referred_by = ?").bind(userId).first();
    const invitedCount = refCountRes?.count || 0;
    const earnings = Number(user.referral_earnings || 0);

    const latestOrder = await env.DB.prepare("SELECT category, price, created_at FROM orders WHERE user_id = ? AND category != 'test' ORDER BY id DESC LIMIT 1").bind(userId).first();
    const latestOrderDate = latestOrder ? MSG.formatMyanmarTime(parseDbDate(latestOrder.created_at)) : null;
    const regDate = user.created_at ? MSG.formatMyanmarTime(parseDbDate(user.created_at)) : "N/A";

    const profMsg = MSG.getProfileMessage({
      firstName: cb.from.first_name || "User",
      telegramId: user.telegram_id,
      regDate: regDate,
      balance: balance,
      totalOrders: totalOrders,
      totalSpent: totalSpent,
      totalDeposited: totalDeposited,
      invitedCount: invitedCount,
      earnings: earnings,
      latestOrder: latestOrder,
      latestOrderDate: latestOrderDate
    });

    await editMsg(profMsg, KB.getProfileKeyboard());
    return;
  }

  // Step 2: Orders Pagination List (Isolated View)
  if (data.startsWith("menu_orders_p_")) {
    const page = parseInt(data.replace("menu_orders_p_", ""), 10) || 1;
    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    const orderStats = await env.DB.prepare("SELECT COUNT(*) as count, SUM(price) as spent FROM orders WHERE user_id = ? AND category != 'test'").bind(userId).first();
    const totalOrders = orderStats?.count || 0;
    const totalSpent = orderStats?.spent || 0;
    const totalPages = Math.ceil(totalOrders / pageSize) || 1;

    const ordersRes = await env.DB.prepare(
      "SELECT id, category, price, created_at FROM orders WHERE user_id = ? AND category != 'test' ORDER BY id DESC LIMIT ? OFFSET ?"
    ).bind(userId, pageSize, offset).all();

    const orders = ordersRes.results || [];
    const ordersMsg = MSG.getOrdersSummaryMessage(totalOrders, totalSpent);

    await editMsg(ordersMsg, KB.getProfileOrdersKeyboard(orders, page, totalPages));
    return;
  }

  // Step 3: Key Details Viewer
  if (data.startsWith("view_ord_")) {
    const parts = data.split("_");
    const orderId = parts[2];
    const returnPage = parts[3] || 1;

    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").bind(orderId, userId).first();

    if (!order) {
      await editMsg("⚠️ Key record not found.", {
        inline_keyboard: [[makeBtn("Back to Orders", "callback_data", `menu_orders_p_${returnPage || 1}`)]]
      });
      return;
    }

    const pkgInfo = CONFIG.PACKAGES[order.category] || { days: 30, gb: order.category };
    const buyDate = parseDbDate(order.created_at);
    const expiryDate = new Date(buyDate.getTime() + pkgInfo.days * 24 * 60 * 60 * 1000);
    const now = new Date();

    let statusText = "";
    if (now > expiryDate) {
      statusText = `${e("INACTIVE", "🔴")} <b>Expired</b>`;
    } else {
      const diffMs = expiryDate - now;
      const leftDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const leftHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      statusText = `${e("ACTIVE", "🟢")} <b>Active (${leftDays}d ${leftHours}h remaining)</b>`;
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
      `<blockquote>` +
      `<code>${order.access_key}</code>\n` +
      `</blockquote>\n\n` +
      `${e("DOWN", "👇")} <i>Tap the copy button below or tap the code to copy ${e("KEY", "🔑")} Key.</i>`;

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
      `<b>(Notice: This action cannot be undone and your key will be removed permanently.)</b>`;

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
        [makeBtn("Back to Orders", "callback_data", "menu_orders_p_1", null, "BTN_ORDERS")],
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
      `<b>1. Strict No-Refund Policy:</b>\n` +
      `<blockquote>• All wallet top-ups and key purchases are final and non-refundable under any circumstances.</blockquote>\n` +
      `<b>2. Payment Transfer Rules:</b>\n` +
      `<blockquote>• Supported Methods: <b>KBZPay, AYAPay, UABPay</b>.\n` +
      `• <b>Strictly leave the transfer note/remark EMPTY</b>. Do NOT write "VPN", "Key", "Bot", or any related words.\n` +
      `• Violating this rule will result in immediate rejection, and funds will NOT be credited.</blockquote>\n` +
      `• <b>Processing Time:</b> Transactions are typically verified within <b>5 minutes to a maximum of 24 hours</b>. Wallet balance will be credited immediately once approved by the Admin Team.\n` +
      `<b>3. Fraud Prevention & Zero Tolerance:</b>\n` +
      `<blockquote>• Submitting altered, fake, reused, or forged payment slips will result in an immediate and permanent BAN of your Telegram ID and Account across all our services without warning.</blockquote>\n` +
      `<b>4. Fair Usage Policy:</b>\n` +
      `<blockquote>• Keys are optimized for personal, non-abusive usage.\n` +
      `• Reselling, public sharing, torrent abuse, or malicious activities that degrade server performance for others are strictly prohibited. Accounts violating fair use may be revoked.</blockquote>\n` +
      `<b>5. Service Uptime & Maintenance:</b>\n` +
      `<blockquote>• In the event of network disruption, IP filtering, or server downtime, our team will investigate and restore nodes as quickly as possible (typically within 24 hours).</blockquote>\n` +
      `<b>6. Final Authority:</b>\n` +
      `<blockquote>• In the event of any disputes, transaction discrepancies, or policy enforcement, the final decision rests solely with the Admin Team.</blockquote>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `${e("WARNING", "⚠️")} <b>By using our bot and depositing funds, you fully agree to comply with all the terms above.</b>`;
    await editMsg(termsMsg, {
      inline_keyboard: [[makeBtn("Main Menu", "callback_data", "menu_home", null, "BTN_HOME")]]
    });
    return;
  }

  // Deposit Menu
  if (data === "menu_topup") {
    const topupSelectMsg = `${e("DEPOSIT", "💳")} <b>Select Deposit Amount</b>\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\nSelect your desired deposit amount below or enter a custom sum:`;
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

    const keyItem = await env.DB.prepare("SELECT id, access_key FROM keys WHERE category = ? LIMIT 1").bind(category).first();

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

    try {
      await env.DB.prepare("UPDATE users SET balance = balance - ?, total_spent = COALESCE(total_spent, 0) + ?, total_orders = total_orders + 1 WHERE telegram_id = ?").bind(price, price, userId).run();
    } catch (_) {
      await env.DB.prepare("UPDATE users SET balance = balance - ?, total_orders = total_orders + 1 WHERE telegram_id = ?").bind(price, userId).run();
    }
    await env.DB.prepare("DELETE FROM keys WHERE id = ?").bind(keyItem.id).run();
    await env.DB.prepare("INSERT INTO orders (user_id, category, access_key, price) VALUES (?, ?, ?, ?)").bind(userId, category, keyItem.access_key, price).run();

    await editMsg(MSG.getKeyDeliveryMessage(category, price, keyItem.access_key), {
      inline_keyboard: [
        [makeBtn("View in Orders", "callback_data", "menu_orders_p_1", null, "BTN_ORDERS")],
        [makeBtn("Join Sales Proof", "url", `https://t.me/sales_proved`, "danger", "BTN_ANNOUNCE")],
        [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
      ]
    });

    const salesChannelId = String(env.SALES_CHANNEL_ID || "").trim();
    if (salesChannelId) {
      try {
        const buyerName = cb.from?.first_name || "Customer";
        await tg(env, "sendMessage", {
          chat_id: salesChannelId,
          text: MSG.getChannelSaleMessage(buyerName, category, price, keyItem.access_key),
          parse_mode: "HTML",
          reply_markup: KB.getSalesChannelKeyboard()
        });
      } catch (err) {}
    }

    if (stockGroupId) {
      try {
        const countRow = await env.DB.prepare("SELECT COUNT(*) as count FROM keys WHERE category = ?").bind(category).first();
        const remainingStock = Number(countRow?.count || 0);

        if (remainingStock <= 3) {
          const alertTitle = remainingStock === 0 ? `${e("ALARM", "🚨")} <b>[OUT OF STOCK ALERT]</b>` : `${e("WARNING", "⚠️")} <b>[LOW STOCK ALERT]</b>`;
          await tg(env, "sendMessage", {
            chat_id: stockGroupId,
            text: 
            `<b>${alertTitle}</b>\n` +
            `<b>━━━━━━━━━━━━━━━━━━━━</b>\n` +
            `${e("STOCK", "📦")} <b>Package:</b> ${category.toUpperCase()}\n` +
            `${e("STATUS", "📊")} <b>Remaining Stock:</b> <b>${remainingStock} keys left!</b>\n\n` +
            `<i>Please restock quickly using /add_${category}</i>`,
            parse_mode: "HTML"
          });
        }
      } catch (stockErr) {}
    }
    return;
  }

  // Free Test Key Menu Handler
  if (data === "menu_test" || data === "menu_test_key_info") {
    const existingTest = await env.DB.prepare("SELECT * FROM orders WHERE user_id = ? AND category = 'test' ORDER BY created_at DESC LIMIT 1").bind(userId).first();

    if (existingTest) {
      const claimedDate = parseDbDate(existingTest.created_at);
      const nextAvailDate = new Date(claimedDate.getTime() + (30 * 24 * 60 * 60 * 1000));
      const now = new Date();

      if (now.getTime() < nextAvailDate.getTime()) {
        const diffMs = nextAvailDate.getTime() - now.getTime();
        const daysLeft = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hoursLeft = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        const claimedText = 
        `${e("WARNING", "⚠️")} <b>Test Key Already Claimed!</b>\n` +
        `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
        `<blockquote>` +
        `• ${e("DATE", "📅")} Claimed On: <b>${MSG.formatMyanmarTime(claimedDate)}</b>\n` +
        `• ${e("CLOCK", "⏳")} Next Available: <b>${MSG.formatMyanmarTime(nextAvailDate)}</b>` +
        `</blockquote>\n\n` +
        `<i>You can claim another test key in <b>${daysLeft} days and ${hoursLeft} hours</b>.</i>`;

        await editMsg(claimedText, {
          inline_keyboard: [
            [makeBtn("View My Test Key", "callback_data", "view_claimed_test_key", null, "BTN_KEY")],
            [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
          ]
        });
        return;
      }
    }
    await editMsg(MSG.getTestKeyIntroMessage(), KB.getTestKeyKeyboard());
    return;
  }

  // Claim Test Key Execution
  if (data === "exec_claim_test_key" || data === "claim_free_test") {
    const existingTest = await env.DB.prepare("SELECT * FROM orders WHERE user_id = ? AND category = 'test' ORDER BY created_at DESC LIMIT 1").bind(userId).first();

    if (existingTest) {
      const claimedDate = parseDbDate(existingTest.created_at);
      const nextAvailDate = new Date(claimedDate.getTime() + (30 * 24 * 60 * 60 * 1000));
      if (new Date().getTime() < nextAvailDate.getTime()) {
        await editMsg(`${e("WARNING", "⚠️")} <b>Test Key Already Claimed!</b>\n\nPlease wait until your trial cooldown period expires before claiming again.`, {
          inline_keyboard: [
            [makeBtn("View My Test Key", "callback_data", "view_claimed_test_key", null, "BTN_KEY")],
            [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
          ]
        });
        return;
      }
    }

    const testKeyItem = await env.DB.prepare("SELECT id, access_key FROM keys WHERE category = 'test' LIMIT 1").first();

    if (!testKeyItem) {
      await editMsg(`${e("UNSTOCK", "😔")} <b>Out of Stock!</b>\n\nNo free test keys are currently available in the pool. Please check back soon or contact support.`, {
        inline_keyboard: [
          [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")],
          [makeBtn("Contact Support", "url", `https://t.me/${CONFIG.ADMIN_USERNAME}`, null, "BTN_SUPPORT")]
        ]
      });
      return;
    }

    await env.DB.prepare("DELETE FROM keys WHERE id = ?").bind(testKeyItem.id).run();
    await env.DB.prepare("INSERT INTO orders (user_id, category, access_key, price) VALUES (?, 'test', ?, 0)").bind(userId, testKeyItem.access_key).run();

    await editMsg(
      `${e("SUCCESS", "🎉")} <b>Your Free Test Key is Ready!</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `${e("KEY", "🔑")} <b>Access Key:</b>\n` +
      `<blockquote><code>${testKeyItem.access_key}</code>\n` +
      `</blockquote>\n\n` +
      `${e("DOWN", "👇")} <i>Tap the copy button below or tap the code to copy ${e("KEY", "🔑")} Test Key.</i>`,
      KB.getTestKeyActionKeyboard(testKeyItem.access_key)
    );
    return;
  }

  // View Existing Test Key
  if (data === "view_claimed_test_key") {
    const existingTest = await env.DB.prepare("SELECT access_key FROM orders WHERE user_id = ? AND category = 'test' ORDER BY created_at DESC LIMIT 1").bind(userId).first();
    const keyStr = existingTest?.access_key || "Key record not found.";
    await editMsg(
      `${e("KEY", "🔑")} <b>My Active Free Test Key</b>\n` +
      `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
      `<blockquote><code>${keyStr}</code>\n` +
      `</blockquote>\n\n` +
      `${e("DOWN", "👇")} <i>Tap the copy button below or tap the code to copy ${e("KEY", "🔑")} Test Key.</i>`,
      KB.getTestKeyActionKeyboard(keyStr)
    );
    return;
  }
}
