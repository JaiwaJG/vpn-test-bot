export const CONFIG = {
  STORE_NAME: "Outline Key Store",
  ADMIN_USERNAME: "JaiwaJG",
  BOT_USERNAME: "jaiwateam_key_bot",

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
    CROWN: "6059615271679696088",
    CHANNEL: "5839394435644788150",         // e.g. "5368324170671202287"
    FIRE: "5289722755871162900",
    VERIFIED: "5289722755871162900",
    USER_ID: "6309581148536183273",
    STAR: "5472164874886846699",
    DOT: "5220103835673969226",
    INFO: "5258503720928288433",
    CLOCK: "5451732530048802485",
    FLASH: "5460991276948143687",
    STATUS: "5458905456145612048",
    DOWN: "6057889171568075218",
    UP: "6055562669388210100",
    ANNOUNCE: "4967835134792303324",

    // Menu & Buttons Icons
    SHOP: "5431499171045581032",
    STOCK: "5154930575995306994",
    UNSTOCK: "5458779239941681169",
    FALSE: "6208506738266610545",
    FREEBIES: "6089047892285200811",
    DEPOSIT: "4972482444025398275",
    BALANCE: "5264713049637409446",
    PROFILE: "5258011929993026890",
    USERS: "5258513401784573443",
    TERMS: "5258503720928288433",
    SUPPORT: "6057677034543391682",

    // Payment Specific Icons
    KPAY: "6055487705029025287",          // KBZPay Custom Logo Emoji
    AYAPAY: "6057575338307754857",        // AYA Pay Custom Logo Emoji
    WALLET: "4972482444025398275",

    // Operations
    SUCCESS: "6300915244562651655",
    DONE: "5260463209562776385",
    WARNING: "5215677343594457295",
    BAN: "6091190140368071716",
    KEY: "5330115548900501467",
    TRASH: "5330115548900501467",
    SLIP: "5444856076954520455",
    DATE: "5258105663359294787",
    TIME: "5258419835922030550",
    PIN: "5258461531464539536",
    CUSTOM: "5470060791883374114",

    //buttton icon
    BTN_SHOP: "5431499171045581032",
    BTN_FREEBIES: "6089047892285200811",
    BTN_DEPOSIT: "4972482444025398275",
    BTN_BALANCE: "5264713049637409446",
    BTN_PROFILE: "5258011929993026890",
    BTN_TERMS: "5258503720928288433",
    BTN_CUSTOM: "5470060791883374114",
    BTN_HOME: "5257963315258204021",
    BTN_SUPPORT: "6057677034543391682",
    BTN_APPROVE: "5260463209562776385",
    BTN_REJECT: "5974083768233760323",
    BTN_KEY: "5330115548900501467",
    BTN_REFRESH: "5244758760429213978",
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

// Inline Keyboard ခလုတ် Helper (Style နှင့် Custom Emoji တည်ဆောက်ခြင်း)
export function makeBtn(title, actionType, actionValue, style = null, emojiIdKey = null) {
  const btn = { text: title };

  if (actionType === "callback_data") btn.callback_data = actionValue;
  if (actionType === "url") btn.url = actionValue;
  if (actionType === "copy_text") btn.copy_text = { text: actionValue };

  if (style) btn.style = style;

  const emojiId = emojiIdKey ? CONFIG.EMOJIS[emojiIdKey] : null;
  if (emojiId && emojiId.trim() !== "") {
    btn.icon_custom_emoji_id = emojiId.trim();
  }

  return btn;
}