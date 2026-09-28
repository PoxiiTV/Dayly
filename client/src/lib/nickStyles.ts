/**
 * Nick decoration, MSN style.
 *
 * Pure data and pure functions: no React, no network, so the transforms can be
 * tested on their own. Everything here produces PLAIN TEXT — the fancy letters
 * are real Unicode, not markup — which is why a nick travels safely through the
 * API, the chat and anywhere else it is shown. Colour and weight are stored
 * separately by the profile; they are never encoded into the text.
 */

export interface NickFont {
  id: string;
  label: string;
  /** 26 glyphs for A-Z, in order. */
  upper: string;
  /** 26 glyphs for a-z, in order. */
  lower: string;
  /** 10 glyphs for 0-9, when the alphabet has them. */
  digits?: string;
}

export const NICK_FONTS: NickFont[] = [
  { id: "gotica", label: "Gótica", upper: "𝕬𝕭𝕮𝕯𝕰𝕱𝕲𝕳𝕴𝕵𝕶𝕷𝕸𝕹𝕺𝕻𝕼𝕽𝕾𝕿𝖀𝖁𝖂𝖃𝖄𝖅", lower: "𝖆𝖇𝖈𝖉𝖊𝖋𝖌𝖍𝖎𝖏𝖐𝖑𝖒𝖓𝖔𝖕𝖖𝖗𝖘𝖙𝖚𝖛𝖜𝖝𝖞𝖟" },
  { id: "burbuja", label: "Burbuja", upper: "ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ", lower: "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ", digits: "⓪①②③④⑤⑥⑦⑧⑨" },
  { id: "cuadrada", label: "Cuadrada", upper: "🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉", lower: "🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉" },
  { id: "doble", label: "Doble", upper: "𝔸𝔹ℂ𝔻𝔼𝔽𝔾ℍ𝕀𝕁𝕂𝕃𝕄ℕ𝕆ℙℚℝ𝕊𝕋𝕌𝕍𝕎𝕏𝕐ℤ", lower: "𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫", digits: "𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡" },
  { id: "ancha", label: "Ancha", upper: "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ", lower: "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ", digits: "０１２３４５６７８９" },
  { id: "cursiva", label: "Cursiva", upper: "𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩", lower: "𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃" },
  { id: "versalitas", label: "Versalitas", upper: "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ", lower: "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ" },
  { id: "mono", label: "Mono", upper: "𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉", lower: "𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣", digits: "𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿" },
];

export interface NickTemplate {
  id: string;
  /** The ornament, with `{n}` where the name goes. */
  pattern: string;
}

export const NICK_TEMPLATES: NickTemplate[] = [
  { id: "estrellas", pattern: "·°¤*(¯`★´¯)*¤°· {n} ·°¤*(¯`★´¯)*¤°·" },
  { id: "olas", pattern: "¤¸¸.•´¯`•¸¸.•..>> {n} <<..•.¸¸•´¯`•.¸¸¤" },
  { id: "corazon", pattern: "»-(¯`v´¯)-» {n} «-(¯`v´¯)-«" },
  { id: "burbujas", pattern: "•._.••´¯``•.¸¸.•• {n} ••.¸¸.•´¯``••._.•" },
  { id: "parentesis", pattern: "(¯`·._.·[ {n} ]·._.·´¯)" },
  { id: "musica", pattern: "♥·.¸¸.·♩♪♫ {n} ♫♪♩·.¸¸.·♥" },
  { id: "zigzag", pattern: "▄▀▄▀▄ {n} ▄▀▄▀▄" },
  { id: "kanji", pattern: "★彡 {n} 彡★" },
  { id: "aire", pattern: "¸„.-•~¹°\"ˆ˜¨ {n} ¨˜ˆ\"°¹~•-.„¸" },
  { id: "flechas", pattern: "→ · . · ° ¤ {n} ¤ ° · . · ←" },
  { id: "baile", pattern: "-漫~*'¨¯¨'*·舞~ {n} ~舞·*'¨¯¨'*~漫-" },
  { id: "gotas", pattern: "°º¤ø,¸¸,ø¤º°`°º¤ø,¸ {n} ¸,ø¤º°`°º¤ø,¸¸,ø¤º°" },
  { id: "espada", pattern: "▬▬ι═══════ﺤ {n} ▬▬ι═══════ﺤ" },
  { id: "flores", pattern: "✿◕ ‿ ◕✿ {n} ✿◕ ‿ ◕✿" },
  { id: "cadena", pattern: "●▬▬▬▬๑۩ {n} ۩๑▬▬▬▬●" },
  { id: "estrellita", pattern: "╰☆╮ {n} ╰☆╮" },
  { id: "brillo", pattern: "✧･ﾟ: *✧･ﾟ {n} ･ﾟ✧*:･ﾟ✧" },
  { id: "cometa", pattern: "+*¨^¨*+ {n} +*¨^¨*+" },
  { id: "alas", pattern: "┌∩┐(◣_◢)┌∩┐ {n} ┌∩┐(◣_◢)┌∩┐" },
  { id: "lluvia", pattern: "¸,ø¤º°`°º¤ø,¸¸,ø¤º° {n} °º¤ø,¸¸,ø¤º°`°º¤ø,¸" },
];

/** Ornaments for building a nick by hand. */
export const NICK_SYMBOLS: string[] = [
  "★", "☆", "✦", "✧", "✩", "✪", "✫", "✬", "✭", "✮", "✯", "❂", "✱", "✲", "✳", "❄", "❅", "❆",
  "♥", "♡", "❤", "♦", "♣", "♠", "♪", "♫", "♬", "♩", "☮", "☯", "☪", "✈", "✉", "✿", "❀", "❁",
  "❃", "❈", "❉", "❊", "❋", "●", "○", "◐", "◑", "◒", "◓", "◔", "◕", "◖", "◗", "◘", "◙", "♀",
  "♂", "☀", "☁", "☂", "☃", "♨", "〠", "¤", "¢", "€", "£", "¥", "§", "¶", "†", "‡", "•", "‣",
  "◆", "◇", "▲", "△", "▼", "▽", "◄", "►", "▬", "▭", "▮", "▯", "๑", "۩", "ﻬ", "彡", "漫", "舞",
  "°", "¯", "`", "´", "¨", "˜", "~", "—", "–"
];

const A = "A".codePointAt(0)!;
const Z = "Z".codePointAt(0)!;
const a = "a".codePointAt(0)!;
const z = "z".codePointAt(0)!;
const ZERO = "0".codePointAt(0)!;
const NINE = "9".codePointAt(0)!;

/**
 * Rewrites a name in one of the alphabets. Anything the alphabet does not
 * cover — accents, spaces, ornaments already in the text — is left alone, so
 * "Kristián ★" keeps both the accent and the star.
 */
export function applyFont(text: string, font: NickFont): string {
  const upper = Array.from(font.upper);
  const lower = Array.from(font.lower);
  const digits = font.digits ? Array.from(font.digits) : null;
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= A && cp <= Z) out += upper[cp - A];
    else if (cp >= a && cp <= z) out += lower[cp - a];
    else if (digits && cp >= ZERO && cp <= NINE) out += digits[cp - ZERO];
    else out += ch;
  }
  return out;
}

/** Wraps a name in an ornament. */
export function applyTemplate(text: string, template: NickTemplate): string {
  return template.pattern.split("{n}").join(text);
}

/** Every ornament applied to the same name, for the picker. */
export function previewTemplates(text: string): { id: string; value: string }[] {
  const name = text.trim() || "TU NOMBRE";
  return NICK_TEMPLATES.map((t) => ({ id: t.id, value: applyTemplate(name, t) }));
}

/** Every alphabet applied to the same name, for the picker. */
export function previewFonts(text: string): { id: string; label: string; value: string }[] {
  const name = text.trim() || "Tu nombre";
  return NICK_FONTS.map((f) => ({ id: f.id, label: f.label, value: applyFont(name, f) }));
}

/** Code points, so the counter matches the server's limit on astral glyphs. */
export function nickLength(value: string): number {
  return Array.from(value).length;
}

export const NICK_MAX = 80;
/** Group names share the decorator but have their own, shorter column. */
export const GROUP_NAME_MAX = 60;
export const SUBNICK_MAX = 120;

/** Colours offered for the nick. */
export const NICK_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#10b981", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899",
];

