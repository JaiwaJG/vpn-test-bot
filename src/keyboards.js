import { CONFIG, makeBtn } from "./config.js";

// Main Store Menu
export function getMainKeyboard() {
  return {
    inline_keyboard: [
      [
        makeBtn("Buy Outline Key", "callback_data", "menu_buy", "success", "BTN_SHOP")
      ],
      [
        makeBtn("Free Test Key", "callback_data", "menu_test", null, "BTN_FREEBIES")
      ],
      [
        makeBtn("Deposit", "callback_data", "menu_topup", null, "BTN_DEPOSIT"),
        makeBtn("My Balance", "callback_data", "menu_balance", null, "BTN_BALANCE")
      ],
      [
        makeBtn("My Profile", "callback_data", "menu_profile_p_1", null, "BTN_PROFILE"),
        makeBtn("Terms of Service", "callback_data", "menu_terms", null, "BTN_TERMS")
      ],
      [
        makeBtn("Referral & Earn", "callback_data", "menu_referral", null, "STAR" )
      ],
      [
        makeBtn("Contact Support", "url", `https://t.me/${CONFIG.ADMIN_USERNAME}`, null, "BTN_SUPPORT")
      ]
    ]
  };
}

// Packages Selection
export function getBuyPackagesKeyboard() {
  return {
    inline_keyboard: [
      [makeBtn("Buy 50 GB — 2,500 MMK", "callback_data", "buy_pkg_50gb_2500", "primary", "BTN_SHOP")],
      [makeBtn("Buy 100 GB — 4,500 MMK", "callback_data", "buy_pkg_100gb_4500", "primary", "BTN_SHOP")],
      [makeBtn("Buy 250 GB — 10,500 MMK", "callback_data", "buy_pkg_250gb_10500", "primary", "BTN_SHOP")],
      [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
    ]
  };
}

// Deposit Selection
export function getTopupKeyboard() {
  return {
    inline_keyboard: [
      [makeBtn("2,500 MMK", "callback_data", "topup_amt_2500", "success", "BTN_DEPOSIT")],
      [makeBtn("4,500 MMK", "callback_data", "topup_amt_4500", "success", "BTN_DEPOSIT")],
      [makeBtn("10,500 MMK", "callback_data", "topup_amt_10500", "success", "BTN_DEPOSIT")],
      [makeBtn("Custom Deposit Amount", "callback_data", "topup_custom", "primary", "BTN_CUSTOM")],
      [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
    ]
  };
}

// Profile Orders Pagination (2 Columns x 5 Rows)
export function getProfileOrdersKeyboard(orders, page, totalPages) {
  let inlineKeyboard = [];
  let row = [];

  orders.forEach((o) => {
    row.push(makeBtn(`Key #${o.id} (${o.category.toUpperCase()})`, "callback_data", `view_ord_${o.id}_${page}`));
    if (row.length === 2) {
      inlineKeyboard.push(row);
      row = [];
    }
  });
  if (row.length > 0) inlineKeyboard.push(row);

  let navRow = [];
  if (page > 1) navRow.push(makeBtn("Prev", "callback_data", `menu_profile_p_${page - 1}`, null, "BTN_PREV"));
  if (totalPages > 1) navRow.push(makeBtn(`${page}/${totalPages}`, "callback_data", "noop", "success", "BTN_PAGE"));
  if (page < totalPages) navRow.push(makeBtn("Next", "callback_data", `menu_profile_p_${page + 1}`, null, "BTN_NEXT"));
  if (navRow.length > 0) inlineKeyboard.push(navRow);

  inlineKeyboard.push([makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]);
  return { inline_keyboard: inlineKeyboard };
}

// Key အသေးစိတ်ကြည့်ရှုသည့် စာမျက်နှာ (Copy & Delete Buttons)
export function getKeyDetailKeyboard(orderId, page, accessKey) {
  const safeKey = accessKey || "No-Key-Found";
  return {
    inline_keyboard: [
      // Tap နှိပ်ရုံဖြင့် Key တန်း copy ယူမည့် Primary Color ခလုတ်
      [makeBtn("Copy Key", "copy_text", safeKey, "primary", "BTN_KEY")],
      // Danger Color (အနီရောင်) Delete ခလုတ်
      [makeBtn("Delete Key", "callback_data", `del_conf_${orderId}_${page}`, "danger", "BTN_DELETE")],
      [makeBtn("Back to List", "callback_data", `menu_profile_p_${page}`, null, "BTN_BACK")],
      [makeBtn("Main Menu", "callback_data", "menu_home", null, "BTN_HOME")]
    ]
  };
}

// Delete Confirmation Keyboard
export function getDeleteConfirmKeyboard(orderId, page) {
  return {
    inline_keyboard: [
      [makeBtn("Yes, Delete Permanently", "callback_data", `del_exec_${orderId}_${page}`, "danger")],
      [makeBtn("Cancel", "callback_data", `view_ord_${orderId}_${page}`)]
    ]
  };
}

// Public sales channel
export function getSalesChannelKeyboard() {
  return {
    inline_keyboard: [
      [makeBtn("Buy Outline Key", "url", `https://t.me/${CONFIG.BOT_USERNAME}?start=menu_buy`, "primary", "BTN_SHOP")]
    ]
  };
}

// Payment Admin Audit Keyboard (Group ထဲတွင် Approve = Primary, Reject/Ban = Danger)
export function getPaymentAdminKeyboard(requestId, targetUserId, amount) {
  return {
    inline_keyboard: [
      [makeBtn(`Approve (+${amount.toLocaleString()} MMK)`, "callback_data", `pay_app_${requestId}_${targetUserId}_${amount}`, "primary", "BTN_APPROVE")],
      [
        makeBtn("Reject Slip", "callback_data", `pay_rej_${requestId}_${targetUserId}`, "danger", "BTN_REJECT"),
        makeBtn("Ban Fraud User", "callback_data", `pay_ban_${targetUserId}`, "danger")
      ]
    ]
  };
}

// Stock Group Refresh Keyboard
export function getStockRefreshKeyboard() {
  return {
    inline_keyboard: [
      [makeBtn("Refresh Stock Status", "callback_data", "admin_refresh_stock", "primary", "BTN_REFRESH")]
    ]
  };
}

// Test Key Delivery & View Keyboard (Copy Button ပါဝင်သည်)
export function getTestKeyActionKeyboard(accessKey) {
  const safeKey = accessKey || "No-Key-Found";
  return {
    inline_keyboard: [
      [makeBtn("Copy Test Key", "copy_text", safeKey, "primary", "BTN_KEY")],
      [makeBtn("Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
    ]
  };
}

// Payment Group: Stats Refresh Keyboard
export function getStatsRefreshKeyboard() {
  return {
    inline_keyboard: [
      [makeBtn("Refresh Stats", "callback_data", "admin_refresh_stats", "primary", "BTN_REFRESH")]
    ]
  };
}

export function getTestKeyKeyboard() {
  return {
    inline_keyboard: [
      [makeBtn(" Claim Free Test Key", "callback_data", "exec_claim_test_key", null, "BTN_KEY")],
      [makeBtn(" Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
    ]
  };
}

export function getReferralKeyboard() {
  return {
    inline_keyboard: [
      [makeBtn(" Back to Home", "callback_data", "menu_home", null, "BTN_HOME")]
    ]
  };
}

export function getMustJoinKeyboard(channelLink) {
  return {
    inline_keyboard: [
      [{ text: "📢 Join Channel", url: channelLink }],
      [{ text: "✅ Check / Continue", callback_data: "check_force_join" }]
    ]
  };
}
