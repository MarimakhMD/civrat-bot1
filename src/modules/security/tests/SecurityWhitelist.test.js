"use strict";

// P9 — whitelist security : validation d'écriture, lecture défensive et
// propriétés de sécurité. 100 % hors ligne : handlers/services réels du
// dépôt, résolvers factices, aucun appel Discord/Pterodactyl/Supabase.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { SecurityConfigKey: Key, SecurityWhitelist } = require("../configuration/securityConstants");
const { openWhitelist, submitWhitelist } = require("../interactions/configureSecurity");
const { SecurityConfigService } = require("../services/SecurityConfigService");
const { SecurityBotService, SecurityBotReason } = require("../services/SecurityBotService");
const { createSecurityRuntime } = require("../runtime/createSecurityRuntime");

// Snowflakes de test aux bornes du pattern (15 / 18 / 22 chiffres).
const ID_15 = "123456789012345";
const ID_18 = "123456789012345678";
const ID_22 = "1234567890123456789012";

/** Soumission RÉELLE via submitWhitelist — renvoie la liste persistée. */
async function submit(raw, envelope) {
  let config = { [Key.WHITELIST]: [] };
  const service = {
    read: async () => config,
    update: async (_g, patch) => {
      config = { ...config, ...patch };
      return config;
    },
  };
  await submitWhitelist({
    service,
    guildId: "g",
    t: (k) => k,
    envelope: envelope === undefined ? { modalValues: { whitelist: raw } } : envelope,
  });
  return config[Key.WHITELIST];
}

/** Lecture RÉELLE via SecurityConfigService sur un stock factice. */
async function readStored(stored) {
  const service = new SecurityConfigService({
    guildConfigResolver: { get: async () => stored, update: async () => ({}) },
  });
  return service.read("g");
}

// ── Constantes (décision 4 : plafond clair et testable) ───────────────────

test("constants: whitelist contract is exported and testable", () => {
  assert.equal(SecurityWhitelist.MAX_ENTRIES, 100);
  assert.equal(SecurityWhitelist.MODAL_MAX_LENGTH, 4000);
  assert.ok(SecurityWhitelist.ID_PATTERN.test(ID_15), "15 digits must match");
  assert.ok(SecurityWhitelist.ID_PATTERN.test("1234567890123456789"), "19 digits must match");
  assert.ok(SecurityWhitelist.ID_PATTERN.test(ID_22), "22 digits must match");
  assert.ok(!SecurityWhitelist.ID_PATTERN.test("12345678901234"), "14 digits must not match");
  assert.ok(!SecurityWhitelist.ID_PATTERN.test("12345678901234567890123"), "23 digits must not match");
  assert.ok(!SecurityWhitelist.ID_PATTERN.test("12345678901234a"), "letters must not match");
  assert.ok(!SecurityWhitelist.ID_PATTERN.test("+123456789012345"), "sign must not match");
  assert.ok(!SecurityWhitelist.ID_PATTERN.test(" 123456789012345"), "leading space must not match");
  assert.ok(!SecurityWhitelist.ID_PATTERN.test("123456789012345 "), "trailing space must not match");
});

// ── Décision 10 — validation à l'écriture (vrai handler submitWhitelist) ──

test("write: keeps valid 15-digit, 18-digit and 22-digit snowflakes", async () => {
  assert.deepEqual(await submit(ID_15), [ID_15]);
  assert.deepEqual(await submit(ID_18), [ID_18]);
  assert.deepEqual(await submit(ID_22), [ID_22]);
});

test("write: drops too short, too long, lettered, signed and space-separated entries silently", async () => {
  const invalid = [
    ["too short (14 digits)", "12345678901234"],
    ["too long (23 digits)", "12345678901234567890123"],
    ["letters tail", "12345678901234a"],
    ["letters only", "abc"],
    ["plus sign", `+${ID_15}`],
    ["minus sign", `-${ID_15}`],
    ["internal space", "1234567890 123456"],
  ];
  for (const [label, raw] of invalid) {
    assert.deepEqual(await submit(raw), [], `${label} must be dropped silently`);
  }
});

test("write: empty or fully invalid submissions produce an empty list without crashing", async () => {
  assert.deepEqual(await submit(""), []);
  assert.deepEqual(await submit("   ,   "), []);
  assert.deepEqual(await submit("abc, 123, +42"), []);
});

test("write: mixed valid/invalid keeps only valid entries and trims around them", async () => {
  assert.deepEqual(await submit(` ${ID_15} , abc, ${ID_18} `), [ID_15, ID_18]);
});

test("write: duplicates are deduplicated preserving first-seen order", async () => {
  assert.deepEqual(
    await submit(`${ID_18}, ${ID_15}, ${ID_18}, ${ID_22}, ${ID_15}`),
    [ID_18, ID_15, ID_22],
  );
});

test("write: 101 entries keep exactly the first 100 (never a mid-list removal)", async () => {
  const ids = Array.from({ length: 101 }, (_, i) => String(100000000000000 + i));
  const kept = await submit(ids.join(", "));
  assert.equal(kept.length, 100);
  assert.equal(kept.length, SecurityWhitelist.MAX_ENTRIES);
  assert.equal(kept[0], ids[0], "first entry must be kept");
  assert.equal(kept[99], ids[99], "entry #100 must be kept");
  assert.ok(!kept.includes(ids[100]), "entry #101 must be dropped");
});

test("write: a list already at the cap stays at 100, strings only (never JS numbers)", async () => {
  const ids = Array.from({ length: 100 }, (_, i) => String(100000000000000 + i));
  const kept = await submit(ids.join(", "));
  assert.equal(kept.length, 100);
  assert.deepEqual(kept, ids);
  assert.ok(kept.every((entry) => typeof entry === "string"), "entries must never be converted to numbers");
});

test("write: missing envelope or modalValues never crashes (fail-closed to [])", async () => {
  assert.deepEqual(await submit(undefined, undefined), []);
  assert.deepEqual(await submit(undefined, {}), []);
  assert.deepEqual(await submit(undefined, { modalValues: {} }), []);
});

test("write/read: prefill surfaces only the normalized list (junk and duplicates absent)", async () => {
  const stored = { [Key.WHITELIST]: [ID_15, "junk", ID_18, ID_15] };
  const service = new SecurityConfigService({
    guildConfigResolver: { get: async () => stored, update: async () => ({}) },
  });
  let modal = null;
  await openWhitelist({
    t: (k) => k,
    service,
    guildId: "g",
    envelope: { transport: { showModal: async (m) => { modal = m; } } },
  });
  assert.equal(modal.fields[0].value, `${ID_15}, ${ID_18}`);
  assert.equal(modal.fields[0].maxLength, SecurityWhitelist.MODAL_MAX_LENGTH);

  // liste vide → préremplissage vide
  modal = null;
  const emptyService = new SecurityConfigService({
    guildConfigResolver: { get: async () => null, update: async () => ({}) },
  });
  await openWhitelist({
    t: (k) => k,
    service: emptyService,
    guildId: "g",
    envelope: { transport: { showModal: async (m) => { modal = m; } } },
  });
  assert.equal(modal.fields[0].value, "");
});

// ── Décision 11 — lecture défensive ────────────────────────────────────────

test("read: undefined, null and scalar whitelists all become []", async () => {
  assert.deepEqual((await readStored(undefined))[Key.WHITELIST], []);
  assert.deepEqual((await readStored(null))[Key.WHITELIST], []);
  assert.deepEqual((await readStored({}))[Key.WHITELIST], []);
  assert.deepEqual((await readStored({ [Key.WHITELIST]: undefined }))[Key.WHITELIST], []);
  assert.deepEqual((await readStored({ [Key.WHITELIST]: null }))[Key.WHITELIST], []);
  assert.deepEqual((await readStored({ [Key.WHITELIST]: "abc" }))[Key.WHITELIST], []);
  assert.deepEqual((await readStored({ [Key.WHITELIST]: 42 }))[Key.WHITELIST], []);
  assert.deepEqual((await readStored({ [Key.WHITELIST]: {} }))[Key.WHITELIST], []);
});

test("read: empty array stays empty, junk filtered, duplicates deduplicated, cap applied", async () => {
  assert.deepEqual((await readStored({ [Key.WHITELIST]: [] }))[Key.WHITELIST], []);
  assert.deepEqual((await readStored({ [Key.WHITELIST]: ["abc", ID_15, "123"] }))[Key.WHITELIST], [ID_15]);
  assert.deepEqual(
    (await readStored({ [Key.WHITELIST]: [ID_15, ID_15, ID_18] }))[Key.WHITELIST],
    [ID_15, ID_18],
  );
  const many = Array.from({ length: 150 }, (_, i) => String(100000000000000 + i));
  const capped = (await readStored({ [Key.WHITELIST]: many }))[Key.WHITELIST];
  assert.equal(capped.length, SecurityWhitelist.MAX_ENTRIES);
  assert.deepEqual(capped, many.slice(0, SecurityWhitelist.MAX_ENTRIES));
});

test("read: an already-clean list resurfaces identical and other Security keys are untouched", async () => {
  const clean = [ID_22, ID_18, ID_15];
  const config = await readStored({
    security_enabled: true,
    security_anti_raid: true,
    [Key.WHITELIST]: clean,
  });
  assert.deepEqual(config[Key.WHITELIST], clean, "clean input must come back identical");
  assert.equal(config.security_enabled, true, "other Security keys must not change");
  assert.equal(config.security_anti_raid, true, "other Security keys must not change");
  assert.equal(config.security_anti_bot, false, "defaults still merge for missing keys");
  // P10 — l'ancienne clé n'apparaît plus nulle part (ni defaults, ni stored).
  assert.equal("security_log_channel_id" in config, false);
});

// ── Décision 12 — sécurité ─────────────────────────────────────────────────

test("security: junk entries can never whitelist a bot (raw consumer and full read path)", async () => {
  const bot = new SecurityBotService();
  // consommateur brut : une entrée junk n'égale jamais un vrai snowflake
  const rawConfig = { security_anti_bot: true, security_whitelist: ["abc", "123"] };
  assert.equal(bot.check({ isBot: true, userId: ID_15, config: rawConfig }).allowed, false);
  // chemin complet : la lecture supprime le junk avant même la comparaison
  const store = { gA: { security_anti_bot: true, security_whitelist: ["abc", "123", `${ID_15} `] } };
  const service = new SecurityConfigService({
    guildConfigResolver: { get: async (id) => store[id] || null, update: async () => ({}) },
  });
  const config = await service.read("gA");
  assert.deepEqual(config[Key.WHITELIST], [], "junk entries must not survive the read");
  assert.equal(bot.check({ isBot: true, userId: ID_15, config }).allowed, false);
  assert.equal(bot.check({ isBot: true, userId: "abc", config }).allowed, false);
  assert.equal(bot.check({ isBot: true, userId: "123", config }).allowed, false);
});

test("security: a valid whitelist keeps working", async () => {
  const store = { gA: { security_enabled: true, security_anti_bot: true, security_whitelist: [ID_15, ID_18] } };
  const service = new SecurityConfigService({
    guildConfigResolver: { get: async (id) => store[id] || null, update: async () => ({}) },
  });
  const bot = new SecurityBotService();
  const config = await service.read("gA");
  assert.deepEqual(bot.check({ isBot: true, userId: ID_15, config }), { allowed: true, reason: SecurityBotReason.BOT_WHITELISTED });
  assert.equal(bot.check({ isBot: true, userId: ID_18, config }).allowed, true);
  assert.deepEqual(bot.check({ isBot: true, userId: ID_22, config }), { allowed: false, reason: SecurityBotReason.BOT_NOT_WHITELISTED });
});

test("security: strict isolation between two guilds", async () => {
  const store = {
    gA: { security_enabled: true, security_anti_bot: true, security_whitelist: [ID_15] },
    gB: { security_enabled: true, security_anti_bot: true, security_whitelist: [ID_18] },
  };
  const service = new SecurityConfigService({
    guildConfigResolver: { get: async (id) => store[id] || null, update: async () => ({}) },
  });
  const bot = new SecurityBotService();
  const a = await service.read("gA");
  const b = await service.read("gB");
  assert.equal(bot.check({ isBot: true, userId: ID_15, config: a }).allowed, true);
  assert.equal(bot.check({ isBot: true, userId: ID_15, config: b }).allowed, false);
  assert.equal(bot.check({ isBot: true, userId: ID_18, config: b }).allowed, true);
  assert.equal(bot.check({ isBot: true, userId: ID_18, config: a }).allowed, false);
  // guild inconnue → défauts (sécurité off) + liste vide fail-closed
  const unknown = await service.read("gZ");
  assert.deepEqual(unknown[Key.WHITELIST], []);
  assert.equal(unknown.security_anti_bot, false, "unknown guild falls back to safe defaults");
  // même en forçant le gate anti-bot, la liste vide refuse tout bot
  assert.equal(bot.check({ isBot: true, userId: ID_15, config: { ...unknown, security_anti_bot: true } }).allowed, false);
});

test("security: runtime end-to-end — whitelisted bot accepted, stranger refused and alerted", async () => {
  const logs = [];
  const store = { g1: { security_enabled: true, security_anti_bot: true, security_whitelist: [ID_15] } };
  const service = new SecurityConfigService({
    guildConfigResolver: { get: async (id) => store[id] || null, update: async () => ({}) },
  });
  const runtime = createSecurityRuntime({
    configService: service,
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => logs.push(e) }),
  });
  const allowed = await runtime.handleMemberJoined({ id: ID_15, guild: { id: "g1" }, user: { bot: true } });
  assert.equal(allowed.bot.allowed, true);
  assert.equal(logs.length, 0, "whitelisted bot must not alert");
  const denied = await runtime.handleMemberJoined({ id: ID_22, guild: { id: "g1" }, user: { bot: true } });
  assert.equal(denied.bot.allowed, false);
  assert.equal(logs.length, 1, "stranger bot must be alerted exactly once");
  assert.equal(logs[0].action, "security_bot");
  assert.equal(logs[0].targetId, ID_22);
});

test("security: whitelist helpers add no runtime dependency (pure functions)", () => {
  const sources = [
    "src/modules/security/configuration/securityConstants.js",
    "src/modules/security/interactions/configureSecurity.js",
  ];
  for (const path of sources) {
    const source = fs.readFileSync(path, "utf8");
    assert.doesNotMatch(source, /require\(["'][^"']*discord\.js["']\)/, `${path} must not depend on discord.js`);
    assert.doesNotMatch(source, /require\(["'][^"']*supabase["']\)/, `${path} must not depend on supabase`);
    assert.doesNotMatch(source, /config\/database/, `${path} must not depend on the database config`);
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${path} must not perform network calls`);
  }
});
