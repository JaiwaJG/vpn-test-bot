export const CONFIG = {
  STORE_NAME: "Prime Outline Store",
  ADMIN_USERNAME: "JaiwaJG",

  // 📱 Payment Information
  PAYMENT: {
    PHONE: "09456545321",
    NAME: "Gum Seng Lat",
    MIN_TOPUP: 2500,
  },

  // 💎 Packages Configuration
  PACKAGES: {
    "50gb": { name: "50 GB High-Speed Plan", price: 2500, days: 30, gb: "50 GB" },
    "100gb": { name: "100 GB High-Speed Plan", price: 4500, days: 35, gb: "100 GB" },
    "250gb": { name: "250 GB High-Speed Plan", price: 10500, days: 75, gb: "250 GB" },
  },

  // 🎨 Button Visual Color Themes (ခလုတ်အရောင် သတ်မှတ်ချက်များ)
  // Telegram ၏ Colored Indicator Emojis များကို လိုသလို ပြောင်းလဲနိုင်ပါသည်
  BUTTON_THEMES: {
    PRIMARY: "🟢",     // Green style (e.g. Buy / Action buttons)
    SECONDARY: "🔵",   // Blue style (e.g. Navigation)
    ACCENT: "🟠",      // Orange/Gold style (e.g. Deposit)
    DANGER: "🔴",      // Red style (e.g. Delete / Reject)
    SPECIAL: "🟣",     // Purple style (e.g. Freebies / Test Key)
  },

  // 🌟 Premium / Custom Telegram Emoji IDs (@getidsbot ဖြင့် ရယူနိုင်သည်)
  EMOJIS: {
    // Brand & UI Icons
    CROWN: "",         // e.g. "5368324170671202287"
    FIRE: "",
    VERIFIED: "",
    USER_ID: "",
    STAR: "",
    DOT: "",
    INFO: "",
    CLOCK: "",
    FLASH: "",
    STATUS: "",
    DOWN: "",
    UP: "",

    // Menu & Buttons Icons
    SHOP: "",
    STOCK: "",
    UNSTOCK: "",
    FALSE: "",
    FREEBIES: "",
    DEPOSIT: "",
    BALANCE: "",
    PROFILE: "",
    TERMS: "",
    SUPPORT: "",

    // Payment Specific Icons
    KPAY: "",          // KBZPay Custom Logo Emoji
    AYAPAY: "",        // AYA Pay Custom Logo Emoji
    WALLET: "",

    // Operations
    SUCCESS: "",
    DONE: "",
    WARNING: "",
    BAN: "",
    KEY: "",
    TRASH: "",
    SLIP: "",
    DATE: "",
    PIN: "",
    CUSTOM: "",
  }
};

// Custom Emoji Helper Function for Messages
export function e(emojiType, fallbackUnicode = "") {
  const emojiId = CONFIG.EMOJIS[emojiType];
  if (emojiId && emojiId.trim() !== "") {
    return `<tg-emoji emoji-id="${emojiId.trim()}">${fallbackUnicode}</tg-emoji>`;
  }
  return fallbackUnicode;
}

// Button Icon Helper (Custom Emoji or Color Style)
export function btnIcon(emojiType, colorTheme = "PRIMARY", fallbackUnicode = "") {
  // Telegram Bot API Inline Keyboards support direct emojis & indicators
  const theme = CONFIG.BUTTON_THEMES[colorTheme] || "";
  const icon = fallbackUnicode || theme;
  return `${icon} `;
}
