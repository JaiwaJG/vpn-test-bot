import { CONFIG, e } from "./config.js";

// Customer အမည်ကို privacy အရ ဖုံးအုပ်ပေးသည့် function
export function maskName(name) {
  if (!name) return "Anonymous";
  const str = String(name).trim();
  if (str.length <= 2) return str[0] + "*";
  return str.slice(0, 2) + "*".repeat(Math.max(1, str.length - 2));
}

// Myanmar Standard Time (UTC+6:30)
export function formatMyanmarTime(dateObj) {
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
  } catch (err) {
    return dateObj.toISOString();
  }
}

// 1. Welcome Message
export function getWelcomeMessage(firstName) {
  return (
    `${e("CROWN", "👑")} <b>Welcome to ${CONFIG.STORE_NAME}!</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `Hello <b>${firstName || "Customer"}</b> ${e("STAR", "✨")}\n\n` +
    `We provide ultra-fast, stable, and encrypted <b>Outline VPN Access Keys</b>. Instant automated delivery after purchase.\n\n` +
    `<blockquote>` +
    `${e("SHOP", "🛍")} <b>Shop</b> — Browse & buy Outline Private Key\n` +
    `${e("FREEBIES", "🎁")} <b>Freebies</b> — Claim monthly free test key\n` +
    `${e("DEPOSIT", "💳")} <b>Deposit</b> — Top up wallet balance\n` +
    `${e("PROFILE", "👤")} <b>My Profile</b> — Balance, keys & order history\n` +
    `${e("TERMS", "📜")} <b>Terms</b> — Store rules & usage policies` +
    `</blockquote>\n\n` +
    `${e("CROWN", "👑")} <b>Channel: @jaiwateam</b>\n\n` +
    `<b>Select an option below to continue.</b>`
  );
}

// 2. Package List
export function getPackageListMessage(balance) {
  return (
    `${e("SHOP", "🛍")} <b>Available Outline VPN Packages</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `${e("BALANCE", "💰")} <b>My Balance:</b> <code>${balance.toLocaleString()} MMK</code>\n\n` +
    `<blockquote>` +
    `${e("DOT", "🔹")} <b>50 GB Plan (30 Days)</b>\n` +
    `• Data: 50 GB | High-Speed Singapore\n` +
    `• Price: <b>2,500 MMK</b>\n` +
    `</blockquote>\n\n` +
    `<blockquote>` +
    `${e("DOT", "🔹")} <b>100 GB Plan (35 Days)</b>\n` +
    `• Data: 100 GB | High-Speed Singapore\n` +
    `• Price: <b>4,500 MMK</b> (Most Popular)\n` +
    `</blockquote>\n\n` +
    `<blockquote>` +
    `${e("DOT", "🔹")} <b>250 GB Plan (75 Days)</b>\n` +
    `• Data: 250 GB | High-Speed Singapore\n` +
    `• Price: <b>10,500 MMK</b> (Heavy User)\n` +
    `</blockquote>\n\n` +
    `${e("FLASH", "⚡️")} <i>Choose a package below for automated instant key delivery:</i>`
  );
}

// 3. Deposit / Payment Info
export function getPaymentInfoMessage(amount) {
  return (
    `${e("DEPOSIT", "💳")} <b>Payment Transfer Instructions</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `${e("BALANCE", "💰")} <b>Required Amount:</b> <code>${amount.toLocaleString()} MMK</code>\n\n` +
    `Please transfer the exact amount to one of our verified accounts:\n\n` +
    `<blockquote>` +
    `${e("KPAY", "📱")} <b>KBZPay:</b> <code>${CONFIG.PAYMENT.PHONE}</code> <b>${CONFIG.PAYMENT.NAME}</b>\n\n` +
    `${e("AYAPAY", "📱")} <b>AYAPay:</b> <code>${CONFIG.PAYMENT.PHONE}</code> <b>${CONFIG.PAYMENT.NAME}</b>\n\n` +
    `${e("UABPAY", "📱")} <b>UABPay:</b> <code>${CONFIG.PAYMENT.PHONE}</code> <b>${CONFIG.PAYMENT.NAME}</b>\n` +
    `</blockquote>\n\n` +
    `${e("WARNING", "⚠️")} <b>Important Transfer Rules:</b>\n` +
    `• Do <b>NOT</b> write VPN, Outline, or Store names in the transaction note.\n` +
    `• Send the transfer <b>Screenshot/Slip</b> directly into this chat.\n` +
    `• Fraudulent/fake slips will result in an immediate permanent ban.\n\n` +
    `${e("SLIP", "🧾")} <i>Send your transaction screenshot/slip now:</i>`
  );
}

// 4. Instant Delivery
export function getKeyDeliveryMessage(category, price, accessKey) {
  const pkg = CONFIG.PACKAGES[category] || { days: 30, gb: category };
  return (
    `${e("SUCCESS", "🎉")} <b>Purchase Successful!</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `<blockquote>` +
    `• ${e("STOCK", "📦")} <b>Package:</b> ${pkg.gb} (${pkg.days} Days)\n` +
    `• ${e("BALANCE", "💰")} <b>Amount Paid:</b> ${price.toLocaleString()} MMK\n` +
    `• ${e("DATE", "📅")} <b>Delivered At:</b> ${formatMyanmarTime(new Date())}` +
    `</blockquote>\n\n` +
    `${e("KEY", "🔑")} <b>Your Outline VPN Key:</b>\n` +
    `<blockquote>` +
    `<code>${accessKey}</code>\n` +
    `</blockquote>\n\n` +
    `${e("UP", "👆")} <i>Tap the key to copy. Your purchased keys are always viewable in ${e("PROFILE", "👤")} <b>My Profile</b>.</i>`

  );
}

// Public Channel Sale Alert
export function getChannelSaleMessage(buyerName, category, price, accessKey) {
  const pkg = CONFIG.PACKAGES[category] || { days: 30, gb: category };
  return (
    `${e("SUCCESS", "🎉")} <b>New Order Completed!</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `<blockquote>` +
    `${e("PROFILE", "👤")} <b>Customer:</b> ${maskName(buyerName)}\n` +
    `${e("STOCK", "📦")} <b>Package:</b> ${pkg.gb} (${pkg.days} Days)\n` +
    `${e("BALANCE", "💰")} <b>Amount Paid:</b> ${price.toLocaleString()} MMK\n` +
    `${e("DATE", "📅")} <b>Delivered At:</b> ${formatMyanmarTime(new Date())}\n` +
    `</blockquote>\n\n` +
    `${e("FLASH", "⚡️")} <i>Instant automated 24/7 delivery by Our Bot.</i>`
  );
}

// 5. Free Test Key Info
export function getTestKeyInfoMessage() {
  return (
    `${e("FREEBIES", "🎁")} <b>Free Outline Test Key</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `Claim an exclusive free test key to experience our high-speed network.\n\n` +
    `<blockquote>` +
    `${e("PIN", "📌")} <b>Freebie Terms:</b>\n` +
    `• Each user can claim <b>1 free test key every 30 days</b>.\n` +
    `• For individual use only; do not re-distribute.\n` +
    `• The claimed key is saved in your Profile.` +
    `</blockquote>\n\n` +
    `Tap the button below to claim your key now. ${e("DOWN", "👇")}`
  );
}

export function getTestKeyIntroMessage() {
  return (
    `${e("FREEBIES", "🎁")} <b>Free Outline Test Key</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `Claim an exclusive free test key to experience our high-speed network.\n\n` +
    `<blockquote>` +
    `${e("PIN", "📌")} <b>Freebie Terms:</b>\n` +
    `• Each user can claim <b>1 free test key every 30 days</b>.\n` +
    `• For individual use only; do not re-distribute.\n` +
    `• The claimed key is saved in your Profile.` +
    `</blockquote>\n\n` +
    `Tap the button below to claim your key now. ${e("DOWN", "👇")}`
  );
}

// Expiration Reminder Notification (English - Buy New Key Only)
export function getExpiryReminderMessage(buyerName, category, accessKey, daysLeft = 2) {
  return (
    `${e("WARNING", "⚠️")} <b>Outline Key Expiry Reminder</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `Hello <b>${buyerName}</b>,\n` +
    `Your Outline VPN key for <b>${category.toUpperCase()}</b> will expire in <b>${daysLeft} days</b>.\n\n` +
    `<blockquote>` +
    `• <b>Plan:</b> ${category.toUpperCase()}\n` +
    `• <b>Status:</b> Expiring Soon\n` +
    `• <b>Key:</b> <code>${accessKey}</code>` +
    `</blockquote>\n\n` +
    `<i>To maintain continuous VPN access, please purchase a new key before your current one expires.</i>`
  );
}

// Test Key Expired & Ready to Claim Again Notification
export function getTestKeyExpiredMessage(buyerName) {
  return (
    `${e("FREEBIES", "🎁")} <b>Trial Period Ended</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `Hello <b>${buyerName}</b>${e("STAR", "✨")},\n` +
    `Your Outline VPN <b>Free Trial Key</b> has expired and has been automatically removed.\n\n` +
    `<blockquote>` +
    `• <b>Status:</b> Expired & Cleared\n` +
    `• <b>Action:</b> You are now eligible to claim a new key or upgrade to a Private Key Plan.` +
    `</blockquote>\n\n` +
    `<i>Tap the button below to get your new Free Trial Key.</i>`
  );
}
