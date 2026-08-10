"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AutoModDetectionService } = require("../services/AutoModDetectionService");

function detectorWithClock(initial = 0) {
  let now = initial;
  const store = new Map();
  const svc = new AutoModDetectionService({ store, clock: () => now });
  return {
    svc,
    store,
    get now() {
      return now;
    },
    set now(v) {
      now = v;
    },
    advance(ms) {
      now += ms;
    },
  };
}

// ── exemptions & status ──────────────────────────────────────────────────

test("AUTOMOD_DISABLED when automod_enabled is false or missing", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "https://x", mentionCount: 0, config: { automod_enabled: false, automod_anti_links: true } }).code, "AUTOMOD_DISABLED");
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "hello", mentionCount: 0, config: {} }).code, "AUTOMOD_DISABLED");
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "hello", mentionCount: 0, config: null }).code, "AUTOMOD_DISABLED");
});

test("AUTOMOD_IGNORED for bot, administrator and manageMessages", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  const cfg = { automod_enabled: true, automod_anti_links: true };
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "https://x", mentionCount: 0, authorIsBot: true, config: cfg }).code, "AUTOMOD_IGNORED");
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "https://x", mentionCount: 0, authorPermissions: { administrator: true }, config: cfg }).code, "AUTOMOD_IGNORED");
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "https://x", mentionCount: 0, authorPermissions: { manageMessages: true }, config: cfg }).code, "AUTOMOD_IGNORED");
  // admin bypass even with multiple violations
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "https://x BAD 😀😀😀 AAAAAAAAAA", mentionCount: 10, authorPermissions: { administrator: true }, config: { automod_enabled: true, automod_anti_links: true, automod_bad_words: ["bad"], automod_anti_emoji_spam: true, automod_emoji_threshold: 2, automod_anti_caps: true, automod_caps_threshold: 70, automod_anti_mention_spam: true, automod_mention_threshold: 2 } }).code, "AUTOMOD_IGNORED");
});

test("AUTOMOD_NO_MATCH for clean messages", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "hello world", mentionCount: 0, config: { automod_enabled: true, automod_anti_links: true, automod_bad_words: ["bad"] } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "", mentionCount: 0, config: { automod_enabled: true, automod_anti_links: true } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: null, mentionCount: 0, config: { automod_enabled: true } }).code, "AUTOMOD_NO_MATCH");
});

// ── links ────────────────────────────────────────────────────────────────

test("links: flag true triggers, flag false does not", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  const on = { automod_enabled: true, automod_anti_links: true };
  const off = { automod_enabled: true, automod_anti_links: false };
  assert.equal(svc.detect({ guildId: "g", authorId: "u1", content: "check https://example.com", mentionCount: 0, config: on }).code, "AUTOMOD_LINK");
  assert.equal(svc.detect({ guildId: "g", authorId: "u2", content: "visit http://example.com", mentionCount: 0, config: on }).code, "AUTOMOD_LINK");
  assert.equal(svc.detect({ guildId: "g", authorId: "u3", content: "see www.example.com", mentionCount: 0, config: on }).code, "AUTOMOD_LINK");
  assert.equal(svc.detect({ guildId: "g", authorId: "u4", content: "https://x", mentionCount: 0, config: off }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u5", content: "example.com", mentionCount: 0, config: on }).code, "AUTOMOD_NO_MATCH");
});

// ── invites ──────────────────────────────────────────────────────────────

test("invites: flag true triggers, flag false does not", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  const on = { automod_enabled: true, automod_anti_invites: true };
  const off = { automod_enabled: true, automod_anti_invites: false };
  assert.equal(svc.detect({ guildId: "g", authorId: "u1", content: "join discord.gg/abc123", mentionCount: 0, config: on }).code, "AUTOMOD_INVITE");
  assert.equal(svc.detect({ guildId: "g", authorId: "u2", content: "https://discord.com/invite/xyz", mentionCount: 0, config: on }).code, "AUTOMOD_INVITE");
  assert.equal(svc.detect({ guildId: "g", authorId: "u3", content: "https://discordapp.com/invite/xyz", mentionCount: 0, config: on }).code, "AUTOMOD_INVITE");
  assert.equal(svc.detect({ guildId: "g", authorId: "u4", content: "Discord.GG/ABC", mentionCount: 0, config: on }).code, "AUTOMOD_INVITE");
  assert.equal(svc.detect({ guildId: "g", authorId: "u5", content: "discord.gg/abc", mentionCount: 0, config: off }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u6", content: "discord.gg without slash", mentionCount: 0, config: on }).code, "AUTOMOD_NO_MATCH");
});

// ── mention spam ───────────────────────────────────────────────────────

test("mention spam: threshold frontier and flag", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  // threshold 5: 5 == no trigger, 6 > trigger
  assert.equal(svc.detect({ guildId: "g", authorId: "u1", content: "hi", mentionCount: 5, config: { automod_enabled: true, automod_anti_mention_spam: true, automod_mention_threshold: 5 } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u2", content: "hi", mentionCount: 6, config: { automod_enabled: true, automod_anti_mention_spam: true, automod_mention_threshold: 5 } }).code, "AUTOMOD_MENTION_SPAM");
  // flag false => no trigger even above threshold
  assert.equal(svc.detect({ guildId: "g", authorId: "u3", content: "hi", mentionCount: 10, config: { automod_enabled: true, automod_anti_mention_spam: false, automod_mention_threshold: 5 } }).code, "AUTOMOD_NO_MATCH");
  // mentionCount undefined => no trigger
  assert.equal(svc.detect({ guildId: "g", authorId: "u4", content: "hi", mentionCount: undefined, config: { automod_enabled: true, automod_anti_mention_spam: true, automod_mention_threshold: 5 } }).code, "AUTOMOD_NO_MATCH");
});

test("mention spam: fallback thresholds (missing, string, NaN)", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  // missing threshold falls back to 5
  assert.equal(svc.detect({ guildId: "g", authorId: "u1", content: "hi", mentionCount: 6, config: { automod_enabled: true, automod_anti_mention_spam: true } }).code, "AUTOMOD_MENTION_SPAM");
  assert.equal(svc.detect({ guildId: "g", authorId: "u2", content: "hi", mentionCount: 5, config: { automod_enabled: true, automod_anti_mention_spam: true } }).code, "AUTOMOD_NO_MATCH");
  // string threshold
  assert.equal(svc.detect({ guildId: "g", authorId: "u3", content: "hi", mentionCount: 6, config: { automod_enabled: true, automod_anti_mention_spam: true, automod_mention_threshold: "5" } }).code, "AUTOMOD_MENTION_SPAM");
  // NaN threshold fallback
  assert.equal(svc.detect({ guildId: "g", authorId: "u4", content: "hi", mentionCount: 6, config: { automod_enabled: true, automod_anti_mention_spam: true, automod_mention_threshold: NaN } }).code, "AUTOMOD_MENTION_SPAM");
});

// ── emoji spam ─────────────────────────────────────────────────────────

test("emoji spam: threshold frontier and flag coherence", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  assert.equal(svc.detect({ guildId: "g", authorId: "u1", content: "😀".repeat(8), mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true, automod_emoji_threshold: 8 } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u2", content: "😀".repeat(9), mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true, automod_emoji_threshold: 8 } }).code, "AUTOMOD_EMOJI_SPAM");
  assert.equal(svc.detect({ guildId: "g", authorId: "u3", content: "😀".repeat(9), mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: false, automod_emoji_threshold: 8 } }).code, "AUTOMOD_NO_MATCH");
  // zero/one emoji with threshold 2
  assert.equal(svc.detect({ guildId: "g", authorId: "u4", content: "hello 😀", mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true, automod_emoji_threshold: 2 } }).code, "AUTOMOD_NO_MATCH");
});

test("emoji spam: unicode vs custom and mixed", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  // custom emojis
  assert.equal(svc.detect({ guildId: "g", authorId: "u1", content: "<:smile:123> <:smile:123> <:smile:123>", mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true, automod_emoji_threshold: 2 } }).code, "AUTOMOD_EMOJI_SPAM");
  assert.equal(svc.detect({ guildId: "g", authorId: "u2", content: "<a:wave:123> <a:wave:123>", mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true, automod_emoji_threshold: 2 } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u3", content: "<a:wave:123> <a:wave:123> <a:wave:123>", mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true, automod_emoji_threshold: 2 } }).code, "AUTOMOD_EMOJI_SPAM");
  // mixed unicode + custom
  assert.equal(svc.detect({ guildId: "g", authorId: "u4", content: "😀 <a:wave:123>", mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true, automod_emoji_threshold: 1 } }).code, "AUTOMOD_EMOJI_SPAM");
  assert.equal(svc.detect({ guildId: "g", authorId: "u5", content: "hello world", mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true, automod_emoji_threshold: 2 } }).code, "AUTOMOD_NO_MATCH");
});

test("emoji spam: fallback thresholds and legacy threshold-only mode", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  // missing threshold falls back to 8
  assert.equal(svc.detect({ guildId: "g", authorId: "u1", content: "😀".repeat(9), mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true } }).code, "AUTOMOD_EMOJI_SPAM");
  assert.equal(svc.detect({ guildId: "g", authorId: "u2", content: "😀".repeat(8), mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true } }).code, "AUTOMOD_NO_MATCH");
  // string threshold
  assert.equal(svc.detect({ guildId: "g", authorId: "u3", content: "😀".repeat(9), mentionCount: 0, config: { automod_enabled: true, automod_anti_emoji_spam: true, automod_emoji_threshold: "8" } }).code, "AUTOMOD_EMOJI_SPAM");
  // legacy: flag absent but threshold >0 should still trigger (backward compat)
  assert.equal(svc.detect({ guildId: "g", authorId: "u4", content: "😀".repeat(3), mentionCount: 0, config: { automod_enabled: true, automod_emoji_threshold: 2 } }).code, "AUTOMOD_EMOJI_SPAM");
  assert.equal(svc.detect({ guildId: "g", authorId: "u5", content: "😀😀", mentionCount: 0, config: { automod_enabled: true, automod_emoji_threshold: 2 } }).code, "AUTOMOD_NO_MATCH");
});

// ── caps ─────────────────────────────────────────────────────────────────

test("caps: frontier, flag and fallback", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  // <8 letters => never caps
  assert.equal(svc.detect({ guildId: "g", authorId: "u1", content: "ABCDEFG", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70 } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u2", content: "ABC", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70 } }).code, "AUTOMOD_NO_MATCH");
  // 50% => no, 62% => no, 75% => yes, 87% => yes, 100% => yes
  assert.equal(svc.detect({ guildId: "g", authorId: "u3", content: "AAAABbbb", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70 } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u4", content: "AAAAAaaa", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70 } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u5", content: "AAAAAAaa", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70 } }).code, "AUTOMOD_CAPS");
  assert.equal(svc.detect({ guildId: "g", authorId: "u6", content: "AAAAAAAa", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70 } }).code, "AUTOMOD_CAPS");
  assert.equal(svc.detect({ guildId: "g", authorId: "u7", content: "AAAAAAAA", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70 } }).code, "AUTOMOD_CAPS");
  // exact 70% frontier
  assert.equal(svc.detect({ guildId: "g", authorId: "u8", content: "AAAAAAAaaa", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70 } }).code, "AUTOMOD_CAPS"); // 7/10=70%
  assert.equal(svc.detect({ guildId: "g", authorId: "u9", content: "AAAAAAaaaa", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70 } }).code, "AUTOMOD_NO_MATCH"); // 6/10=60%
  // flag false => no
  assert.equal(svc.detect({ guildId: "g", authorId: "u10", content: "AAAAAAAA", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: false, automod_caps_threshold: 70 } }).code, "AUTOMOD_NO_MATCH");
  // threshold 80: 75% => no, 87% => yes
  assert.equal(svc.detect({ guildId: "g", authorId: "u11", content: "AAAAAAaa", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 80 } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u12", content: "AAAAAAAa", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 80 } }).code, "AUTOMOD_CAPS");
  // fallback missing -> 70
  assert.equal(svc.detect({ guildId: "g", authorId: "u13", content: "AAAAAAAA", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true } }).code, "AUTOMOD_CAPS");
  assert.equal(svc.detect({ guildId: "g", authorId: "u14", content: "AAAAAAAA", mentionCount: 0, config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: "70" } }).code, "AUTOMOD_CAPS");
});

// ── bad words ────────────────────────────────────────────────────────────

test("bad words: filtering, case, substring and NFKD", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  // empty array or only empty strings => NO_MATCH (regression for [] includes "" bug)
  assert.equal(svc.detect({ guildId: "g", authorId: "u1", content: "hello", mentionCount: 0, config: { automod_enabled: true, automod_bad_words: [] } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u2", content: "hello", mentionCount: 0, config: { automod_enabled: true, automod_bad_words: ["", "  "] } }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g", authorId: "u3", content: "hello", mentionCount: 0, config: { automod_enabled: true, automod_bad_words: [null, 123] } }).code, "AUTOMOD_NO_MATCH");
  // case-insensitive
  assert.equal(svc.detect({ guildId: "g", authorId: "u4", content: "BAD", mentionCount: 0, config: { automod_enabled: true, automod_bad_words: ["bad"] } }).code, "AUTOMOD_BAD_WORD");
  assert.equal(svc.detect({ guildId: "g", authorId: "u5", content: "bad", mentionCount: 0, config: { automod_enabled: true, automod_bad_words: ["BAD"] } }).code, "AUTOMOD_BAD_WORD");
  // substring
  assert.equal(svc.detect({ guildId: "g", authorId: "u6", content: "badword", mentionCount: 0, config: { automod_enabled: true, automod_bad_words: ["bad"] } }).code, "AUTOMOD_BAD_WORD");
  assert.equal(svc.detect({ guildId: "g", authorId: "u7", content: "this is bad!", mentionCount: 0, config: { automod_enabled: true, automod_bad_words: ["bad"] } }).code, "AUTOMOD_BAD_WORD");
  // NFKD: café (precomposed) vs cafe + combining acute
  assert.equal(svc.detect({ guildId: "g", authorId: "u8", content: "cafe\u0301", mentionCount: 0, config: { automod_enabled: true, automod_bad_words: ["café"] } }).code, "AUTOMOD_BAD_WORD");
  assert.equal(svc.detect({ guildId: "g", authorId: "u9", content: "café", mentionCount: 0, config: { automod_enabled: true, automod_bad_words: ["cafe\u0301"] } }).code, "AUTOMOD_BAD_WORD");
  assert.equal(svc.detect({ guildId: "g", authorId: "u10", content: "hello world", mentionCount: 0, config: { automod_enabled: true, automod_bad_words: ["bad"] } }).code, "AUTOMOD_NO_MATCH");
});

// ── spam ─────────────────────────────────────────────────────────────────

test("spam: flood 5 messages in window", () => {
  const { svc, advance } = detectorWithClock(0);
  const cfg = { automod_enabled: true, automod_anti_spam: true };
  for (let i = 0; i < 4; i++) {
    const res = svc.detect({ guildId: "g", authorId: "spammer", content: `msg ${i}`, mentionCount: 0, config: cfg });
    assert.equal(res.code, "AUTOMOD_NO_MATCH", `flood ${i} should not spam`);
    advance(1000);
  }
  assert.equal(svc.detect({ guildId: "g", authorId: "spammer", content: "msg 4", mentionCount: 0, config: cfg }).code, "AUTOMOD_SPAM");
});

test("spam: duplicate 3 times triggers, 2 does not, case-insensitive via NFKD", () => {
  const { svc, advance } = detectorWithClock(0);
  const cfg = { automod_enabled: true, automod_anti_spam: true };
  assert.equal(svc.detect({ guildId: "g", authorId: "dup", content: "hello", mentionCount: 0, config: cfg }).code, "AUTOMOD_NO_MATCH");
  advance(500);
  assert.equal(svc.detect({ guildId: "g", authorId: "dup", content: "hello", mentionCount: 0, config: cfg }).code, "AUTOMOD_NO_MATCH");
  advance(500);
  // third duplicate, different case but normalized => SPAM
  assert.equal(svc.detect({ guildId: "g", authorId: "dup", content: "HELLO", mentionCount: 0, config: cfg }).code, "AUTOMOD_SPAM");
});

test("spam: NFKD duplicate (café vs cafe\\u0301)", () => {
  const { svc, advance } = detectorWithClock(0);
  const cfg = { automod_enabled: true, automod_anti_spam: true };
  svc.detect({ guildId: "g", authorId: "u", content: "café", mentionCount: 0, config: cfg });
  advance(200);
  svc.detect({ guildId: "g", authorId: "u", content: "café", mentionCount: 0, config: cfg });
  advance(200);
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "cafe\u0301", mentionCount: 0, config: cfg }).code, "AUTOMOD_SPAM");
});

test("spam: window expiration clears history", () => {
  const { svc, advance } = detectorWithClock(0);
  const cfg = { automod_enabled: true, automod_anti_spam: true };
  for (let i = 0; i < 4; i++) {
    svc.detect({ guildId: "g", authorId: "flood", content: `m${i}`, mentionCount: 0, config: cfg });
    advance(1000);
  }
  // 4 in 4s => not spam yet
  assert.equal(svc.detect({ guildId: "g", authorId: "flood", content: "m4", mentionCount: 0, config: { automod_enabled: true, automod_anti_spam: false } }).code, "AUTOMOD_NO_MATCH"); // flag off, but history still tracked? actually flag false won't check but history already pushed
  // advance beyond 8s window
  advance(10000);
  // new detector with same store but after window should not spam
  assert.equal(svc.detect({ guildId: "g", authorId: "flood", content: "new", mentionCount: 0, config: cfg }).code, "AUTOMOD_NO_MATCH");
});

test("spam: isolation per guild and author and per store", () => {
  const { svc } = detectorWithClock(0);
  const cfg = { automod_enabled: true, automod_anti_spam: true };
  // 5 messages for u1 in g1 => spam for u1/g1 only
  for (let i = 0; i < 5; i++) {
    svc.detect({ guildId: "g1", authorId: "u1", content: `a${i}`, mentionCount: 0, config: cfg });
  }
  assert.equal(svc.detect({ guildId: "g1", authorId: "u1", content: "a5", mentionCount: 0, config: cfg }).code, "AUTOMOD_SPAM");
  assert.equal(svc.detect({ guildId: "g1", authorId: "u2", content: "a", mentionCount: 0, config: cfg }).code, "AUTOMOD_NO_MATCH");
  assert.equal(svc.detect({ guildId: "g2", authorId: "u1", content: "a", mentionCount: 0, config: cfg }).code, "AUTOMOD_NO_MATCH");
  // separate instance with separate store is isolated
  const other = new AutoModDetectionService({ store: new Map() });
  assert.equal(other.detect({ guildId: "g1", authorId: "u1", content: "isolated", mentionCount: 0, config: cfg }).code, "AUTOMOD_NO_MATCH");
});

test("spam: flag off does not trigger even with flood", () => {
  const { svc, advance } = detectorWithClock(0);
  const off = { automod_enabled: true, automod_anti_spam: false };
  for (let i = 0; i < 6; i++) {
    assert.equal(svc.detect({ guildId: "g", authorId: "u", content: `x${i}`, mentionCount: 0, config: off }).code, "AUTOMOD_NO_MATCH");
    advance(500);
  }
});

test("spam: clock injection and clear()", () => {
  const store = new Map();
  let now = 0;
  const svc = new AutoModDetectionService({ store, clock: () => now });
  const cfg = { automod_enabled: true, automod_anti_spam: true };
  for (let i = 0; i < 5; i++) {
    svc.detect({ guildId: "g", authorId: "u", content: "hi", mentionCount: 0, config: cfg });
    now += 100;
  }
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "hi", mentionCount: 0, config: cfg }).code, "AUTOMOD_SPAM");
  svc.clear();
  assert.equal(svc.detect({ guildId: "g", authorId: "u", content: "hi", mentionCount: 0, config: cfg }).code, "AUTOMOD_NO_MATCH");
  // custom window
  const fast = new AutoModDetectionService({ store: new Map(), clock: () => now, windowMs: 1000 });
  fast.detect({ guildId: "g", authorId: "v", content: "a", mentionCount: 0, config: cfg });
  now += 500;
  fast.detect({ guildId: "g", authorId: "v", content: "b", mentionCount: 0, config: cfg });
  now += 600; // beyond 1000 window from first
  // history of first should be expired, so only 1 in window
  assert.equal(fast.detect({ guildId: "g", authorId: "v", content: "c", mentionCount: 0, config: cfg }).code, "AUTOMOD_NO_MATCH");
});

// ── priority & multi-rules ──────────────────────────────────────────────

test("priority: SPAM first, then LINK > INVITE > MENTION > EMOJI > CAPS > BAD_WORD", () => {
  const svc = new AutoModDetectionService({ store: new Map() });
  // link vs invite vs mention: LINK first
  let res = svc.detect({
    guildId: "g",
    authorId: "u1",
    content: "https://discord.gg/abc hi",
    mentionCount: 10,
    config: { automod_enabled: true, automod_anti_links: true, automod_anti_invites: true, automod_anti_mention_spam: true, automod_mention_threshold: 2, automod_bad_words: ["bad"] },
  });
  assert.equal(res.code, "AUTOMOD_LINK");
  assert.ok(res.rules.includes("AUTOMOD_LINK"));
  assert.ok(res.rules.includes("AUTOMOD_INVITE"));
  assert.ok(res.rules.includes("AUTOMOD_MENTION_SPAM"));
  assert.deepEqual(res.rules, ["AUTOMOD_LINK", "AUTOMOD_INVITE", "AUTOMOD_MENTION_SPAM"]);

  // emoji vs caps vs bad: EMOJI first
  res = svc.detect({
    guildId: "g",
    authorId: "u2",
    content: "😀😀😀 AAAAAAAA bad",
    mentionCount: 0,
    config: { automod_enabled: true, automod_anti_emoji_spam: true, automod_emoji_threshold: 2, automod_anti_caps: true, automod_caps_threshold: 70, automod_bad_words: ["bad"] },
  });
  assert.equal(res.code, "AUTOMOD_EMOJI_SPAM");
  assert.deepEqual(res.rules, ["AUTOMOD_EMOJI_SPAM", "AUTOMOD_CAPS", "AUTOMOD_BAD_WORD"]);

  // caps vs bad: CAPS first
  res = svc.detect({
    guildId: "g",
    authorId: "u3",
    content: "AAAAAAAA bad",
    mentionCount: 0,
    config: { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70, automod_bad_words: ["bad"] },
  });
  assert.equal(res.code, "AUTOMOD_CAPS");
  assert.deepEqual(res.rules, ["AUTOMOD_CAPS", "AUTOMOD_BAD_WORD"]);
});

test("priority: spam over link", () => {
  const { svc, advance } = detectorWithClock(0);
  const cfg = { automod_enabled: true, automod_anti_spam: true, automod_anti_links: true };
  for (let i = 0; i < 4; i++) {
    svc.detect({ guildId: "g", authorId: "pri", content: `m${i}`, mentionCount: 0, config: cfg });
    advance(100);
  }
  const res = svc.detect({ guildId: "g", authorId: "pri", content: "https://x", mentionCount: 0, config: cfg });
  // 5th message in 500ms + link => both SPAM and LINK, SPAM first
  assert.equal(res.code, "AUTOMOD_SPAM");
  assert.deepEqual(res.rules, ["AUTOMOD_SPAM", "AUTOMOD_LINK"]);
});

// ── transport-neutral & regression from T1 ──────────────────────────────

test("regression: original T1 cases still pass", () => {
  const base = {
    guildId: "g",
    authorId: "u",
    content: "hello",
    mentionCount: 0,
    config: { automod_enabled: true, automod_anti_links: true, automod_anti_invites: true, automod_anti_mention_spam: true, automod_mention_threshold: 2, automod_emoji_threshold: 2, automod_anti_caps: true, automod_caps_threshold: 70, automod_bad_words: ["bad"] },
  };
  const svc = new AutoModDetectionService({ store: new Map() });
  assert.equal(svc.detect({ ...base, content: "https://x" }).code, "AUTOMOD_LINK");
  assert.equal(svc.detect({ ...base, content: "BAD" }).code, "AUTOMOD_BAD_WORD");
  // caps with threshold 70
  const capsSvc = new AutoModDetectionService({ store: new Map() });
  assert.equal(capsSvc.detect({ ...base, content: "AAAAAAAA" }).code, "AUTOMOD_CAPS");
  assert.equal(svc.detect({ ...base, mentionCount: 3 }).code, "AUTOMOD_MENTION_SPAM");
  assert.equal(svc.detect({ ...base, config: { automod_enabled: false } }).code, "AUTOMOD_DISABLED");
});
