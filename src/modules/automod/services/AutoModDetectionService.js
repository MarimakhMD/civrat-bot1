"use strict";

const DEFAULT_WINDOW_MS = 8000;

// P8 — détection liens/invites.
//  • LINK_RE   : https:// + http:// + www. (avec frontière à gauche pour
//    exclure `nowww.example` / `mywww.example`) + variantes d'obfuscation
//    hxxp:// et hxxps:// (indication d'obfuscation de protocole).
//  • INVITE_RE : discord.gg + discord(dapp).com/invite(S)/ — le « s »
//    couvre les liens Discovery. Codes d'invitation limités au jeu ASCII
//    historique [\w-] (aucun format nouveau inventé).
// Les deux règles s'appliquent à la copie normalizeForDetection() ci-dessous,
// JAMAIS au texte brut (logs/sanctions/spam/bad words/caps/emoji restent sur
// le brut — source officielle inchangée).
const LINK_RE = /(?:https?:\/\/|hxxps?:\/\/|(?<![\p{L}\p{N}])www\.)\S+/iu;
const INVITE_RE = /(?:discord\.gg\/|discord(?:app)?\.com\/invites?\/)[\w-]+/iu;
const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;
const EXTENDED_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const LETTER_RE = /\p{L}/u;

// Caractères de format Unicode (ZWSP U+200B, soft hyphen U+00AD, BOM
// U+FEFF, marques directionnelles…) — supprimés de la copie de détection.
const DETECT_CF_RE = /\p{Cf}/gu;
// Séquence littérale `[.]` (obfuscation par crochets).
const DETECT_BRACKET_DOT_RE = /\[\.]/g;
// Points obfusqués restants après NFKD : `。` U+3002, `｡` U+FF61 (NFKD le
// ramène en U+3002) et `．` U+FF0E (redondant avec NFKD, conservé par sécurité).
const DETECT_UNICODE_DOT_RE = /[。｡．]/gu;
// Espace(s) immédiatement avant un point : couvre `discord .gg/abc` sans
// rejoindre les mots d'une phrase (un espace AVANT `www` n'est pas touché).
const DETECT_SPACE_BEFORE_DOT_RE = /(?<=\S)\s+(?=\.)/g;

/**
 * P8 — normalisation DÉTECTION-ONLY pour les règles LINK et INVITE.
 *
 * Opérations (et rien d'autre) :
 *   1. NFKD           — plie les formes fullwidth (dont `．` → `.`) ;
 *   2. toLowerCase    — casse insensible ;
 *   3. strip \p{Cf}   — ZWSP / soft hyphen / BOM / marques ;
 *   4. repli des points obfusqués `[.]`, `。`, `｡`, `．` → `.` ;
 *   5. retrait de l'espace immédiatement avant un point (forme `x .y`).
 *
 * Interdits (contrat P8) : homoglyphes cyrilliques/grecs, décodage %XX,
 * new URL(), parsing d'URL, table de confusables, normalisation globale du
 * message. Le texte brut reste la source officielle.
 */
function normalizeForDetection(value) {
  return (value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(DETECT_CF_RE, "")
    .replace(DETECT_BRACKET_DOT_RE, ".")
    .replace(DETECT_UNICODE_DOT_RE, ".")
    .replace(DETECT_SPACE_BEFORE_DOT_RE, "");
}

function normalize(value) {
  return (value || "").normalize("NFKD").toLowerCase();
}

function countEmojis(text) {
  const unicode = [...text].filter((char) => EXTENDED_PICTOGRAPHIC_RE.test(char)).length;
  const custom = (text.match(CUSTOM_EMOJI_RE) || []).length;
  return unicode + custom;
}

/**
 * Transport-neutral AutoMod detection engine.
 *
 * The engine is deterministic and injectable: callers can provide a clock
 * and a store to make spam-window behaviour testable without real timers.
 * When no dependencies are supplied, it behaves exactly like the legacy
 * implementation (in-memory Map, Date.now(), 8s window).
 *
 * Return contract is preserved:
 *   { matched: boolean, code: string, rules: string[] }
 * where `code` is the first matched rule or a status code
 * (AUTOMOD_DISABLED / AUTOMOD_IGNORED / AUTOMOD_NO_MATCH).
 *
 * Rule priority is intentionally fixed:
 *   SPAM > LINK > INVITE > MENTION_SPAM > EMOJI_SPAM > CAPS > BAD_WORD
 */
class AutoModDetectionService {
  constructor(options = {}) {
    const { clock, store, windowMs } = options;
    this.clock = typeof clock === "function" ? clock : () => Date.now();
    this.store = store instanceof Map ? store : new Map();
    this.windowMs = Number.isFinite(windowMs) ? windowMs : DEFAULT_WINDOW_MS;
  }

  clear() {
    this.store.clear();
  }

  detect(input) {
    const config = (input && input.config) || {};
    const out = (code, rules = []) => ({ matched: rules.length > 0, code, rules });

    if (!config.automod_enabled) {
      return out("AUTOMOD_DISABLED");
    }

    if (input.authorIsBot || input.authorPermissions?.administrator || input.authorPermissions?.manageMessages) {
      return out("AUTOMOD_IGNORED");
    }

    // P7 — exemption par rôle OU par salon : flag minimal calculé une seule
    // fois par le runtime (choke point create+update). Placé AVANT le push du
    // compteur de spam → aucun comptage, aucune règle, aucune sanction,
    // aucun log AutoMod. Les exemptions bot/admin restent prioritaires ci-dessus.
    if (input.exempt === true) {
      return out("AUTOMOD_IGNORED");
    }

    const rules = [];
    const text = input.content || "";
    const key = `${input.guildId}:${input.authorId}`;
    const now = this.clock();
    const history = (this.store.get(key) || []).filter((entry) => now - entry.t < this.windowMs);
    // Une ÉDITION (même `messageId`) ne doit pas gonfler artificiellement le
    // compteur de spam : on met à jour l'entrée existante (contenu courant,
    // horodatage d'origine conservé) au lieu d'en pousser une nouvelle. Sans
    // `messageId` (appels legacy / création), comportement strictement
    // inchangé : une nouvelle entrée est poussée.
    if (input.messageId != null) {
      const existing = history.find((entry) => entry.m === input.messageId);
      if (existing) {
        existing.c = normalize(text);
      } else {
        history.push({ t: now, c: normalize(text), m: input.messageId });
      }
    } else {
      history.push({ t: now, c: normalize(text) });
    }
    this.store.set(key, history);

    if (config.automod_anti_spam && (history.length >= 5 || history.filter((entry) => entry.c && entry.c === normalize(text)).length >= 3)) {
      rules.push("AUTOMOD_SPAM");
    }

    // P8 — liens/invites sur la copie de détection UNIQUEMENT (calculée une
    // fois, uniquement si au moins une des deux règles est active). Le
    // contenu brut `text` reste intact pour toutes les autres règles.
    // Priorité inchangée : LINK poussé AVANT INVITE (SPAM > LINK > INVITE > …).
    if (config.automod_anti_links || config.automod_anti_invites) {
      const detectText = normalizeForDetection(text);
      if (config.automod_anti_links && LINK_RE.test(detectText)) {
        rules.push("AUTOMOD_LINK");
      }
      if (config.automod_anti_invites && INVITE_RE.test(detectText)) {
        rules.push("AUTOMOD_INVITE");
      }
    }

    const mentionThresholdRaw = config.automod_mention_threshold;
    const mentionThreshold = Number.isFinite(Number(mentionThresholdRaw)) ? Number(mentionThresholdRaw) : 5;
    if (config.automod_anti_mention_spam && Number.isFinite(input.mentionCount) && input.mentionCount > mentionThreshold) {
      rules.push("AUTOMOD_MENTION_SPAM");
    }

    // Flag coherence: respect automod_anti_emoji_spam when present, fallback to
    // threshold>0 only for legacy direct calls; thresholds fallback to defaults.
    const emojiThresholdRaw = config.automod_emoji_threshold;
    const emojiThreshold = Number.isFinite(Number(emojiThresholdRaw)) ? Number(emojiThresholdRaw) : 8;
    const hasEmojiFlag = typeof config.automod_anti_emoji_spam === "boolean";
    const emojiEnabled = hasEmojiFlag ? config.automod_anti_emoji_spam : emojiThreshold > 0;
    if (emojiEnabled && countEmojis(text) > emojiThreshold) {
      rules.push("AUTOMOD_EMOJI_SPAM");
    }

    const letters = [...text].filter((char) => LETTER_RE.test(char));
    if (config.automod_anti_caps && letters.length >= 8) {
      const upper = letters.filter((char) => char === char.toUpperCase()).length;
      const ratio = Math.round((upper / letters.length) * 100);
      const capsThresholdRaw = config.automod_caps_threshold;
      const capsThreshold = Number.isFinite(Number(capsThresholdRaw)) ? Number(capsThresholdRaw) : 70;
      if (ratio >= capsThreshold) {
        rules.push("AUTOMOD_CAPS");
      }
    }

    const badWords = Array.isArray(config.automod_bad_words)
      ? config.automod_bad_words.filter((word) => typeof word === "string" && word.trim().length > 0)
      : [];
    if (badWords.length && badWords.some((word) => normalize(text).includes(normalize(word)))) {
      rules.push("AUTOMOD_BAD_WORD");
    }

    return rules.length ? out(rules[0], rules) : out("AUTOMOD_NO_MATCH");
  }
}

module.exports = { AutoModDetectionService, DEFAULT_WINDOW_MS, normalizeForDetection };
