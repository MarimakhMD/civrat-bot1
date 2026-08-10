"use strict";

const DEFAULT_WINDOW_MS = 8000;

const LINK_RE = /(?:https?:\/\/|www\.)\S+/i;
const INVITE_RE = /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)[\w-]+/i;
const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;
const EXTENDED_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const LETTER_RE = /\p{L}/u;

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

    const rules = [];
    const text = input.content || "";
    const key = `${input.guildId}:${input.authorId}`;
    const now = this.clock();
    const history = (this.store.get(key) || []).filter((entry) => now - entry.t < this.windowMs);
    history.push({ t: now, c: normalize(text) });
    this.store.set(key, history);

    if (config.automod_anti_spam && (history.length >= 5 || history.filter((entry) => entry.c && entry.c === normalize(text)).length >= 3)) {
      rules.push("AUTOMOD_SPAM");
    }

    if (config.automod_anti_links && LINK_RE.test(text)) {
      rules.push("AUTOMOD_LINK");
    }

    if (config.automod_anti_invites && INVITE_RE.test(text)) {
      rules.push("AUTOMOD_INVITE");
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

module.exports = { AutoModDetectionService, DEFAULT_WINDOW_MS };
