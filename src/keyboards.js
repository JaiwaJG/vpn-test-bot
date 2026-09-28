import { CONFIG, btnIcon, e } from "./config.js";

// Main Store Menu
export function getMainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: `${e("SHOP", "PRIMARY", "🛍")} Buy Outline Key`, callback_data: "menu_buy" },
        { text: `${e("FREEBIES", "SPECIAL", "🎁")} Free Test Key`, callback_data: "menu_test_key_info" }
      ],
      [
        { text: `${e("DEPOSIT", "ACCENT", "💳")} Deposit`, callback_data: "menu_topup" },
        { text: `${e("BALANCE", "SECONDARY", "💵")} My Balance`, callback_data: "menu_balance" }
      ],
      [
        { text: `${e("PROFILE", "SECONDARY", "👤")} My Profile`, callback_data: "menu_profile_p_1" },
        { text: `${e("TERMS", "SECONDARY", "📜")} Terms of Service`, callback_data: "menu_terms" }
      ],
      [
        { text: `${e("SUPPORT", "PRIMARY", "💬")} Contact Support`, url: `https://t.me/${CONFIG.ADMIN_USERNAME}` }
      ]
    ]
  };
}

// Package Purchase Selection
export function getBuyPackagesKeyboard() {
  return {
    inline_keyboard: [
      [{ text: `${btnIcon("SHOP", "PRIMARY", "🛒")} Buy 50 GB — 2,500 MMK`, callback_data: "buy_pkg_50gb_2500" }],
      [{ text: `${btnIcon("SHOP", "PRIMARY", "🛒")} Buy 100 GB — 4,500 MMK`, callback_data: "buy_pkg_100gb_4500" }],
      [{ text: `${btnIcon("SHOP", "PRIMARY", "🛒")} Buy 250 GB — 10,500 MMK`, callback_data: "buy_pkg_250gb_10500" }],
      [{ text: "🔙 Back to Home", callback_data: "menu_home" }]
    ]
  };
}

// Deposit Amount Selection
export function getTopupKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "💵 2,500 MMK (50 GB Plan)", callback_data: "topup_amt_2500" }],
      [{ text: "💵 4,500 MMK (100 GB Plan)", callback_data: "topup_amt_4500" }],
      [{ text: "💵 10,500 MMK (250 GB Plan)", callback_data: "topup_amt_10500" }],
      [{ text: "✍️ Custom Deposit Amount", callback_data: "topup_custom" }],
      [{ text: "🔙 Back to Home", callback_data: "menu_home" }]
    ]
  };
}

// Profile Orders Pagination (2 Columns x 5 Rows)
export function getProfileOrdersKeyboard(orders, page, totalPages) {
  let inlineKeyboard = [];
  let row = [];

  orders.forEach((o) => {
    row.push({
      text: `🔑 #${o.id} (${o.category.toUpperCase()})`,
      callback_data: `view_ord_${o.id}_${page}`
    });
    if (row.length === 2) {
      inlineKeyboard.push(row);
      row = [];
    }
  });
  if (row.length > 0) inlineKeyboard.push(row);

  let navRow = [];
  if (page > 1) {
    navRow.push({ text: "◀️ Prev", callback_data: `menu_profile_p_${page - 1}` });
  }
  if (totalPages > 1) {
    navRow.push({ text: `📄 ${page}/${totalPages}`, callback_data: "noop" });
  }
  if (page < totalPages) {
    navRow.push({ text: "Next ▶️", callback_data: `menu_profile_p_${page + 1}` });
  }
  if (navRow.length > 0) inlineKeyboard.push(navRow);

  inlineKeyboard.push([{ text: "🔙 Back to Home", callback_data: "menu_home" }]);
  return { inline_keyboard: inlineKeyboard };
}

// Key Details & Delete Action
export function getKeyDetailKeyboard(orderId, page) {
  return {
    inline_keyboard: [
      [{ text: `${btnIcon("TRASH", "DANGER", "🗑")} Delete Key from Profile`, callback_data: `del_conf_${orderId}_${page}` }],
      [{ text: "🔙 Back to List", callback_data: `menu_profile_p_${page}` }],
      [{ text: "🏠 Main Menu", callback_data: "menu_home" }]
    ]
  };
}

// Delete Confirmation
export function getDeleteConfirmKeyboard(orderId, page) {
  return {
    inline_keyboard: [
      [{ text: "✅ Yes, Delete Permanently", callback_data: `del_exec_${orderId}_${page}` }],
      [{ text: "❌ Cancel", callback_data: `view_ord_${orderId}_${page}` }]
    ]
  };
}

// Payment Admin Audit Keyboard
export function getPaymentAdminKeyboard(requestId, targetUserId, amount) {
  return {
    inline_keyboard: [
      [{ text: `✅ Approve (+${amount.toLocaleString()} MMK)`, callback_data: `pay_app_${requestId}_${targetUserId}_${amount}` }],
      [
        { text: "❌ Reject Slip", callback_data: `pay_rej_${requestId}_${targetUserId}` },
        { text: "🚫 Ban Fraud User", callback_data: `pay_ban_${targetUserId}` }
      ]
    ]
  };
}

// Stock Group Refresh
export function getStockRefreshKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔄 Refresh Stock Status", callback_data: "admin_refresh_stock" }]
    ]
  };
}
