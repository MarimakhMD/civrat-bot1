"use strict";

/**
 * P7 — exemptions AutoMod par rôle / par salon (GO implémentation).
 *
 * 45 tests obligatoires du GO :
 *   1–11   configuration (clés, defaults, normalisation, limites, rate-limit)
 *   12–16  exemptions par rôle
 *   17–22  exemptions par salon
 *   23–26  combos rôle / salon
 *   27–29  spam (aucun comptage pour un exempté)
 *   30–34  messageUpdate (choke point commun, garde P1 préservée)
 *   35–45  non-régression (bot/admin/ManageMessages, règles, sanctions,
 *          ConfigService, vues, routes, i18n, events intouchés, flag detect)
 *
 * Hors ligne : zéro Discord, zéro Supabase, zéro Pterodactyl.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { createAutoModRuntime, isExemptFromAutoMod } = require("../runtime/createAutoModRuntime");
const { AutoModDetectionService } = require("../services/AutoModDetectionService");
const { AutoModEnforcementService } = require("../services/AutoModEnforcementService");
const { AutoModConfigService, AUTOMOD_DEFAULTS, normalizeExemptList } = require("../services/AutoModConfigService");
const {
  AutoModConfigKey: Key,
  AutoModComponentId: Id,
  AutoModExemptLimits,
  EXEMPT_ID_PATTERN,
} = require("../configuration/automodConstants");
const { autoModView, autoModExemptView } = require("../interactions/automodViews");
const {
  selectAutoModExemptRoles,
  selectAutoModExemptChannels,
  resetAutoModExemptRoles,
  resetAutoModExemptChannels,
} = require("../interactions/configureAutoMod");
const { registerAutoMod } = require("../register");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { GUILD_CONFIG_KEYS, GUILD_CONFIG_KEY_SET } = require("../../../services/guildConfigKeys");
const { rows, renderView, MAX_ACTION_ROWS } = require("../../../adapters/discord/DiscordResponseTransport");

// ────────────────────────────────────────────────────────────────────────────
// Fixtures partagées — snowflakes factices (18 chiffres), hors Discord.
// ────────────────────────────────────────────────────────────────────────────

const GUILD = "600000000000000001"; // = ID de @everyone
const AUTHOR = "700000000000000001";
const ROLE_A = "600000000000000101";
const ROLE_B = "600000000000000102";
const ROLE_GONE = "600000000000000199"; // rôle supprimé (dangling)
const CH_TEXT = "600000000000000201";
const CH_NEWS = "600000000000000202";
const CH_CATEGORY = "600000000000000203";
const CH_THREAD = "600000000000000204";
const CH_DEFAULT = "600000000000000299"; // salon non exempté

function makeClock() {
  let now = 1_000_000;
  return { clock: () => now, advance: (ms) => (now += ms) };
}

/**
 * Message factice avec roles.cache / channelId : exactement les deux
 * surfaces lues par `isExemptFromAutoMod` (aucun fetch ne doit exister).
 */
function makeMessage({
  id = "m1",
  content = "",
  bot = false,
  admin = false,
  manageMessages = false,
  roles = [],
  channelId = CH_DEFAULT,
  mentionCount = 0,
} = {}) {
  const roleSet = new Set(roles);
  return {
    id,
    guild: { id: GUILD },
    author: { id: AUTHOR, bot },
    channelId,
    member: {
      permissions: {
        has: (name) => (name === "Administrator" ? admin : name === "ManageMessages" ? manageMessages : false),
      },
      roles: { cache: { has: (roleId) => roleSet.has(roleId) } },
    },
    content,
    mentions: { users: { size: mentionCount } },
    partial: false,
  };
}

function makeHarness({ config, store } = {}) {
  const { clock, advance } = makeClock();
  const enforcerCalls = { deleted: [], timeouts: [], warns: [] };
  const moderationLogs = [];
  const enforcer = {
    deleteMessage: async (message) => { enforcerCalls.deleted.push(message.id); },
    timeoutUser: async (options) => { enforcerCalls.timeouts.push(options); return { ok: true }; },
    warnUser: async (options) => { enforcerCalls.warns.push(options); return { ok: true }; },
  };
  const detectionStore = store || new Map();
  const runtime = createAutoModRuntime({
    configService: { read: async () => ({ automod_enabled: true, ...config }) },
    detection: new AutoModDetectionService({ clock, store: detectionStore }),
    enforcementService: new AutoModEnforcementService({ logger: { warn: () => {} } }),
    enforcerFactory: () => enforcer,
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => moderationLogs.push(e) }),
  });
  return { runtime, enforcerCalls, moderationLogs, advance, store: detectionStore };
}

/** Guild factice : `roles.cache.has` / `channels.cache.get` uniquement. */
function makeGuild({ roles = [], channels = [] } = {}) {
  const roleSet = new Set([GUILD, ...roles]); // @everyone toujours présent en cache
  const channelMap = new Map(channels); // [id, { type }]
  return {
    id: GUILD,
    roles: { everyone: { id: GUILD }, cache: { has: (id) => roleSet.has(id) } },
    channels: { cache: { get: (id) => channelMap.get(id) || null } },
  };
}

function makeService(store = {}) {
  const reads = [];
  const writes = [];
  return {
    reads,
    writes,
    store,
    read: async () => { reads.push(true); return { ...store }; },
    update: async (_guildId, patch) => { writes.push(patch); Object.assign(store, patch); return { ...store }; },
  };
}

const allowGuard = { check: () => ({ allowed: true }), record: () => {} };
const denyGuard = { check: () => ({ allowed: false }), record: () => { throw new Error("record() must not run when denied"); } };

function makeContext({ guild, values = [], service, guard = allowGuard } = {}) {
  const replies = [];
  const ctx = {
    guildId: GUILD,
    userId: "700000000000000009",
    t: (key) => key,
    envelope: {
      values,
      discordMember: guild ? { guild } : null,
      transport: { reply: async (payload) => replies.push(payload) },
    },
    service,
    rateLimitGuard: guard,
  };
  return { ctx, replies };
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION (1–11)
// ════════════════════════════════════════════════════════════════════════════

test("1. config : read() sans stockage renvoie les deux listes exempt à []", async () => {
  const service = new AutoModConfigService({ guildConfigResolver: { get: async () => null, update: async () => ({}) } });
  const config = await service.read(GUILD);
  assert.deepEqual(config.automod_exempt_roles, []);
  assert.deepEqual(config.automod_exempt_channels, []);
});

test("2. config : read() normalise un stockage corrompu (scalaire / null) en []", async () => {
  const service = new AutoModConfigService({
    guildConfigResolver: { get: async () => ({ automod_exempt_roles: "oops", automod_exempt_channels: null }), update: async () => ({}) },
  });
  const config = await service.read(GUILD);
  assert.deepEqual(config.automod_exempt_roles, []);
  assert.deepEqual(config.automod_exempt_channels, []);
});

test("3. config : read() filtre les entrées non-string des listes stockées", async () => {
  const service = new AutoModConfigService({
    guildConfigResolver: {
      get: async () => ({ automod_exempt_roles: [ROLE_A, 42, null, "", ROLE_B], automod_exempt_channels: [CH_TEXT, {}, undefined] }),
      update: async () => ({}),
    },
  });
  const config = await service.read(GUILD);
  assert.deepEqual(config.automod_exempt_roles, [ROLE_A, ROLE_B]);
  assert.deepEqual(config.automod_exempt_channels, [CH_TEXT]);
});

test("4. config : read() conserve les listes valides et fusionne avec les défauts", async () => {
  const service = new AutoModConfigService({
    guildConfigResolver: { get: async () => ({ automod_enabled: true, automod_exempt_roles: [ROLE_A] }), update: async () => ({}) },
  });
  const config = await service.read(GUILD);
  assert.equal(config.automod_enabled, true);
  assert.deepEqual(config.automod_exempt_roles, [ROLE_A]);
  assert.deepEqual(config.automod_exempt_channels, []);
  assert.equal(config.automod_punishment, AUTOMOD_DEFAULTS.automod_punishment, "défauts historiques inchangés");
});

test("5. config : AutoModConfigKey déclare les deux clés d'exemption", () => {
  assert.equal(Key.EXEMPT_ROLES, "automod_exempt_roles");
  assert.equal(Key.EXEMPT_CHANNELS, "automod_exempt_channels");
});

test("6. config : AUTOMOD_DEFAULTS contient les deux clés à []", () => {
  assert.deepEqual(AUTOMOD_DEFAULTS.automod_exempt_roles, []);
  assert.deepEqual(AUTOMOD_DEFAULTS.automod_exempt_channels, []);
});

test("7. config : whitelist guildConfig accepte les deux clés (bidirectionnelle)", () => {
  for (const key of ["automod_exempt_roles", "automod_exempt_channels"]) {
    assert.ok(GUILD_CONFIG_KEYS.includes(key), `${key} manque dans GUILD_CONFIG_KEYS`);
    assert.ok(GUILD_CONFIG_KEY_SET.has(key), `${key} manque dans GUILD_CONFIG_KEY_SET`);
  }
});

test("8. config : limites — MAX_IDS 10 et salons [0, 5] uniquement", () => {
  assert.equal(AutoModExemptLimits.MAX_IDS, 10);
  assert.deepEqual([...AutoModExemptLimits.CHANNEL_TYPES], [0, 5]);
  assert.ok(!AutoModExemptLimits.CHANNEL_TYPES.includes(4), "catégories interdites");
  assert.ok(!AutoModExemptLimits.CHANNEL_TYPES.includes(10), "threads interdits");
});

test("9. config : EXEMPT_ID_PATTERN accepte les snowflakes 15–22 chiffres, refuse tout le reste", () => {
  assert.equal(EXEMPT_ID_PATTERN.test("123456789012345"), true);
  assert.equal(EXEMPT_ID_PATTERN.test("1234567890123456789012"), true);
  assert.equal(EXEMPT_ID_PATTERN.test("12345678901234"), false, "14 chiffres");
  assert.equal(EXEMPT_ID_PATTERN.test("12345678901234567890123"), false, "23 chiffres");
  assert.equal(EXEMPT_ID_PATTERN.test("abc"), false);
  assert.equal(EXEMPT_ID_PATTERN.test(""), false);
  assert.equal(EXEMPT_ID_PATTERN.test("123 456789012345"), false);
});

test("10. config : les 6 componentIds de la sous-vue Exemptions existent, sont uniques et chevauchent les routes existantes", () => {
  const ids = [Id.EXEMPT_OPEN, Id.EXEMPT_ROLES_SELECT, Id.EXEMPT_CHANNELS_SELECT, Id.EXEMPT_RESET_ROLES, Id.EXEMPT_RESET_CHANNELS, Id.EXEMPT_BACK];
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6, "customIds uniques");
  for (const id of ids) assert.match(id, /^civrat:v1:automod:/);
  // Contrat « zéro nouvelle route » (GO correction) : les boutons exempt
  // montent sur la route prefix des règles, les selects sur la route prefix
  // unique des selects AutoMod.
  for (const id of [Id.EXEMPT_OPEN, Id.EXEMPT_BACK, Id.EXEMPT_RESET_ROLES, Id.EXEMPT_RESET_CHANNELS]) {
    assert.ok(id.startsWith(`${Id.TOGGLE_PREFIX}:`), `${id} doit passer par la route prefix ${Id.TOGGLE_PREFIX}:`);
  }
  for (const id of [Id.EXEMPT_ROLES_SELECT, Id.EXEMPT_CHANNELS_SELECT, Id.ENFORCE_SELECT]) {
    assert.ok(id.startsWith(Id.SELECT_PREFIX), `${id} doit passer par la route prefix select ${Id.SELECT_PREFIX}`);
  }
});

test("11. config : rate-limit P6 — refus = null, AUCUNE lecture ni écriture, réponse éphémère", async () => {
  const service = makeService({});
  const guild = makeGuild({ roles: [ROLE_A] });
  const { ctx, replies } = makeContext({ guild, values: [ROLE_A], service, guard: denyGuard });
  const saved = await selectAutoModExemptRoles(ctx);
  assert.equal(saved, null, "retour null sur dépassement (pattern suggestions)");
  assert.equal(service.reads.length, 0, "aucun read avant la garde");
  assert.equal(service.writes.length, 0, "aucun upsert sur refus");
  assert.equal(replies.length, 1, "réponse éphémère envoyée par la garde");
  assert.equal(replies[0].ephemeral, true);
  assert.equal(replies[0].view.content, "ratelimit.retry");
});

// ════════════════════════════════════════════════════════════════════════════
// EXEMPTIONS PAR RÔLE (12–16)
// ════════════════════════════════════════════════════════════════════════════

test("12. rôle : écriture dédupliquée, @everyone (ID guilde) exclu", async () => {
  const service = makeService({});
  const guild = makeGuild({ roles: [ROLE_A, ROLE_B] });
  const { ctx } = makeContext({ guild, values: [ROLE_A, ROLE_A, ROLE_B, GUILD], service });
  await selectAutoModExemptRoles(ctx);
  assert.equal(service.writes.length, 1);
  assert.deepEqual(service.writes[0], { automod_exempt_roles: [ROLE_A, ROLE_B] }, "Set dedup + exclusion @everyone");
});

test("13. rôle : plafond de 10 rôles (15 candidats → 10 stockés) ; merge borné à 10", async () => {
  const fifteen = Array.from({ length: 15 }, (_, i) => `60000000000001${String(i).padStart(4, "0")}`);
  const service = makeService({});
  const guild = makeGuild({ roles: fifteen });
  const { ctx } = makeContext({ guild, values: fifteen, service });
  await selectAutoModExemptRoles(ctx);
  assert.equal(service.writes[0].automod_exempt_roles.length, 10);

  // Stockage déjà plein + 1 nouveau → reste à 10 (jamais 11).
  const service2 = makeService({ automod_exempt_roles: [...fifteen.slice(0, 10)] });
  const { ctx: ctx2 } = makeContext({ guild, values: [fifteen[10]], service: service2 });
  await selectAutoModExemptRoles(ctx2);
  assert.equal(service2.writes[0].automod_exempt_roles.length, 10, "plafond maintenu après merge");
});

test("14. rôle : valeurs invalides / étrangères / non validables ignorées sans exception", async () => {
  const service = makeService({ automod_exempt_roles: [ROLE_B] });
  const guild = makeGuild({ roles: [ROLE_A] }); // ROLE_GONE absent du cache = rôle d'une autre guilde ou supprimé
  const { ctx } = makeContext({
    guild,
    values: ["abc", "123", 42, null, ROLE_A, ROLE_GONE, GUILD],
    service,
  });
  let error = null;
  try {
    await selectAutoModExemptRoles(ctx);
  } catch (e) {
    error = e;
  }
  assert.equal(error, null, "jamais d'exception");
  // Seuls ROLE_A (nouveau, valide) et ROLE_B (stockage conservé, Reset = nettoyage) restent.
  assert.deepEqual(service.writes[0].automod_exempt_roles, [ROLE_A, ROLE_B]);

  // Sans guild : rien n'est validable → la sélection entrante est ignorée proprement.
  const service2 = makeService({ automod_exempt_roles: [ROLE_B] });
  const { ctx: ctx2 } = makeContext({ guild: null, values: [ROLE_A], service: service2 });
  await selectAutoModExemptRoles(ctx2);
  assert.deepEqual(service2.writes[0].automod_exempt_roles, [ROLE_B]);
});

test("15. rôle : auteur avec rôle exempt → AUTOMOD_IGNORED, 0 spam, 0 règle, 0 sanction, 0 log", async () => {
  const h = makeHarness({
    config: {
      automod_anti_links: true,
      automod_anti_spam: true,
      automod_delete_message: true,
      automod_exempt_roles: [ROLE_A],
      automod_exempt_channels: [],
    },
  });
  const result = await h.runtime.handleMessage(makeMessage({ id: "x1", content: "viens voir https://evil.example", roles: [ROLE_A] }));
  assert.equal(result.matched, false);
  assert.equal(result.code, "AUTOMOD_IGNORED");
  assert.equal(h.enforcerCalls.deleted.length, 0, "aucune suppression");
  assert.equal(h.moderationLogs.length, 0, "aucun log");
  assert.equal(h.store.size, 0, "aucune entrée dans le compteur de spam");
});

test("16. rôle : rôle supprimé (dangling) n'exempte plus ; @everyone en stockage n'exempte jamais", async () => {
  // Rôle supprimé : encore en stockage mais absent du cache de l'auteur → modéré.
  const h1 = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [ROLE_GONE], automod_exempt_channels: [] },
  });
  const dangling = await h1.runtime.handleMessage(makeMessage({ id: "g1", content: "https://evil.example", roles: [] }));
  assert.equal(dangling.matched, true, "un rôle inexistant n'exempte pas");
  assert.deepEqual(h1.enforcerCalls.deleted, ["g1"]);

  // @everyone stocké (bypass tentative) : même si le cache le contient, jamais exempt.
  const h2 = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [GUILD], automod_exempt_channels: [] },
  });
  const everyone = await h2.runtime.handleMessage(makeMessage({ id: "g2", content: "https://evil.example", roles: [GUILD] }));
  assert.equal(everyone.matched, true, "@everyone ne doit jamais exempter");
  assert.deepEqual(h2.enforcerCalls.deleted, ["g2"]);
});

// ════════════════════════════════════════════════════════════════════════════
// EXEMPTIONS PAR SALON (17–22)
// ════════════════════════════════════════════════════════════════════════════

test("17. salon : le texte (type 0) est accepté et écrit", async () => {
  const service = makeService({});
  const guild = makeGuild({ channels: [[CH_TEXT, { type: 0 }]] });
  const { ctx } = makeContext({ guild, values: [CH_TEXT], service });
  await selectAutoModExemptChannels(ctx);
  assert.deepEqual(service.writes[0], { automod_exempt_channels: [CH_TEXT] });
});

test("18. salon : les annonces (type 5) sont acceptées", async () => {
  const service = makeService({});
  const guild = makeGuild({ channels: [[CH_NEWS, { type: 5 }]] });
  const { ctx } = makeContext({ guild, values: [CH_NEWS], service });
  await selectAutoModExemptChannels(ctx);
  assert.deepEqual(service.writes[0], { automod_exempt_channels: [CH_NEWS] });
});

test("19. salon : une catégorie (type 4) est rejetée même si elle traverse le select", async () => {
  const service = makeService({});
  const guild = makeGuild({ channels: [[CH_CATEGORY, { type: 4 }], [CH_TEXT, { type: 0 }]] });
  const { ctx } = makeContext({ guild, values: [CH_CATEGORY, CH_TEXT], service });
  await selectAutoModExemptChannels(ctx);
  assert.deepEqual(service.writes[0], { automod_exempt_channels: [CH_TEXT] }, "catégorie exclue, texte conservé");
});

test("20. salon : un thread (type 11) est rejeté — pas d'exemption via parentId", async () => {
  const service = makeService({});
  const guild = makeGuild({ channels: [[CH_THREAD, { type: 11 }]] });
  const { ctx } = makeContext({ guild, values: [CH_THREAD], service });
  await selectAutoModExemptChannels(ctx);
  assert.deepEqual(service.writes[0], { automod_exempt_channels: [] });
});

test("21. salon : message dans un salon exempt → AUTOMOD_IGNORED, 0 spam, 0 règle, 0 sanction, 0 log", async () => {
  const h = makeHarness({
    config: {
      automod_anti_links: true,
      automod_anti_spam: true,
      automod_delete_message: true,
      automod_exempt_roles: [],
      automod_exempt_channels: [CH_TEXT],
    },
  });
  const result = await h.runtime.handleMessage(makeMessage({ id: "s1", content: "spam https://evil.example", channelId: CH_TEXT }));
  assert.equal(result.matched, false);
  assert.equal(result.code, "AUTOMOD_IGNORED");
  assert.equal(h.enforcerCalls.deleted.length, 0);
  assert.equal(h.moderationLogs.length, 0);
  assert.equal(h.store.size, 0, "compteur de spam non alimenté");
});

test("22. salon : reset rôles / reset salons écrivent [] sur leur seule liste, garde P6 incluse", async () => {
  // Reset rôles autorisé.
  const service = makeService({ automod_exempt_roles: [ROLE_A], automod_exempt_channels: [CH_TEXT] });
  const { ctx } = makeContext({ guild: makeGuild({ roles: [ROLE_A], channels: [[CH_TEXT, { type: 0 }]] }), service });
  await resetAutoModExemptRoles(ctx);
  assert.deepEqual(service.writes[0], { automod_exempt_roles: [] });
  assert.deepEqual(service.store.automod_exempt_channels, [CH_TEXT], "liste salons intacte");

  // Reset salons autorisé.
  const service2 = makeService({ automod_exempt_roles: [ROLE_A], automod_exempt_channels: [CH_TEXT] });
  const { ctx: ctx2 } = makeContext({ guild: makeGuild(), service: service2 });
  await resetAutoModExemptChannels(ctx2);
  assert.deepEqual(service2.writes[0], { automod_exempt_channels: [] });
  assert.deepEqual(service2.store.automod_exempt_roles, [ROLE_A], "liste rôles intacte");

  // Reset refusé par la rate-limit : null + aucun write.
  const service3 = makeService({ automod_exempt_roles: [ROLE_A] });
  const { ctx: ctx3 } = makeContext({ guild: makeGuild(), service: service3, guard: denyGuard });
  const denied = await resetAutoModExemptRoles(ctx3);
  assert.equal(denied, null);
  assert.equal(service3.writes.length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// COMBOS RÔLE / SALON (23–26) — sémantique OU
// ════════════════════════════════════════════════════════════════════════════

test("23. combo : rôle exempt seul (salon non exempt) → ignoré", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [ROLE_A], automod_exempt_channels: [CH_TEXT] },
  });
  const result = await h.runtime.handleMessage(makeMessage({ content: "https://evil.example", roles: [ROLE_A], channelId: CH_DEFAULT }));
  assert.equal(result.code, "AUTOMOD_IGNORED");
  assert.equal(h.enforcerCalls.deleted.length, 0);
});

test("24. combo : salon exempt seul (rôle non exempt) → ignoré", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [ROLE_A], automod_exempt_channels: [CH_TEXT] },
  });
  const result = await h.runtime.handleMessage(makeMessage({ content: "https://evil.example", roles: [], channelId: CH_TEXT }));
  assert.equal(result.code, "AUTOMOD_IGNORED");
  assert.equal(h.enforcerCalls.deleted.length, 0);
});

test("25. combo : rôle ET salon exempt → un seul passage, ignoré", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [ROLE_A], automod_exempt_channels: [CH_TEXT] },
  });
  const result = await h.runtime.handleMessage(makeMessage({ content: "https://evil.example", roles: [ROLE_A], channelId: CH_TEXT }));
  assert.equal(result.code, "AUTOMOD_IGNORED");
  assert.equal(h.moderationLogs.length, 0, "aucun log, aucune double exécution");
});

test("26. combo : aucun des deux → détecté et sanctionné (contrôle OU)", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [ROLE_A], automod_exempt_channels: [CH_TEXT] },
  });
  const result = await h.runtime.handleMessage(makeMessage({ content: "https://evil.example", roles: [ROLE_B], channelId: CH_DEFAULT }));
  assert.equal(result.matched, true);
  assert.equal(result.code, "AUTOMOD_LINK");
  assert.deepEqual(h.enforcerCalls.deleted, ["m1"]);
  assert.equal(h.moderationLogs.length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// SPAM (27–29) — un exempté n'alimente jamais le compteur
// ════════════════════════════════════════════════════════════════════════════

test("27. spam : flux entièrement exempt → 0 entrée spam, aucun SPAM après 6 messages", async () => {
  const h = makeHarness({
    config: { automod_anti_spam: true, automod_delete_message: false, automod_exempt_channels: [CH_TEXT] },
  });
  for (let i = 1; i <= 6; i++) {
    const r = await h.runtime.handleMessage(makeMessage({ id: `f${i}`, content: `message ${i}`, channelId: CH_TEXT }));
    assert.equal(r.code, "AUTOMOD_IGNORED", `message ${i} exempté`);
  }
  assert.equal(h.store.size, 0, "le store de spam reste vide");
  assert.equal(h.enforcerCalls.deleted.length, 0);
});

test("28. spam : 4 non-exempt + 1 exempt → l'exempté ressort IGNORED et n'atteint pas le seuil 5", async () => {
  const h = makeHarness({
    config: { automod_anti_spam: true, automod_delete_message: false, automod_exempt_channels: [CH_TEXT] },
  });
  for (let i = 1; i <= 4; i++) {
    const r = await h.runtime.handleMessage(makeMessage({ id: `n${i}`, content: `message ${i}`, channelId: CH_DEFAULT }));
    assert.equal(r.matched, false);
    assert.notEqual(r.code, "AUTOMOD_SPAM");
  }
  const exempt = await h.runtime.handleMessage(makeMessage({ id: "n5", content: "message 5", channelId: CH_TEXT }));
  assert.equal(exempt.code, "AUTOMOD_IGNORED", "le 5e serait SPAM s'il était compté");
  const entries = h.store.get(`${GUILD}:${AUTHOR}`) || [];
  assert.equal(entries.length, 4, "l'exempté n'a pas d'entrée dans le compteur");
});

test("29. spam : contrôle — 5 non-exempt déclenchent toujours SPAM (legacy inchangé)", async () => {
  const h = makeHarness({
    config: { automod_anti_spam: true, automod_delete_message: false, automod_exempt_channels: [CH_TEXT] },
  });
  let spam = null;
  for (let i = 1; i <= 5; i++) {
    const r = await h.runtime.handleMessage(makeMessage({ id: `k${i}`, content: `message ${i}`, channelId: CH_DEFAULT }));
    if (r.code === "AUTOMOD_SPAM") spam = r;
  }
  assert.ok(spam, "le flux non exempté déclenche toujours SPAM");
});

// ════════════════════════════════════════════════════════════════════════════
// messageUpdate (30–34) — choke point commun, garde P1 préservée
// ════════════════════════════════════════════════════════════════════════════

test("30. messageUpdate : création + édition en salon exempt → les deux ignorés, 0 log", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_channels: [CH_TEXT] },
  });
  const created = await h.runtime.handleMessage(makeMessage({ id: "e1", content: "bonjour", channelId: CH_TEXT }));
  assert.equal(created.code, "AUTOMOD_IGNORED");
  const edited = await h.runtime.handleMessageEdited(
    makeMessage({ id: "e1", content: "bonjour", channelId: CH_TEXT }),
    makeMessage({ id: "e1", content: "salut tout le monde", channelId: CH_TEXT }),
  );
  assert.equal(edited.matched, false);
  assert.equal(edited.code, "AUTOMOD_IGNORED");
  assert.equal(h.enforcerCalls.deleted.length, 0);
  assert.equal(h.moderationLogs.length, 0);
});

test("31. messageUpdate : changer un contenu pour un lien en salon exempt ne contourne pas", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_channels: [CH_TEXT] },
  });
  await h.runtime.handleMessage(makeMessage({ id: "e2", content: "bonjour", channelId: CH_TEXT }));
  const edited = await h.runtime.handleMessageEdited(
    makeMessage({ id: "e2", content: "bonjour", channelId: CH_TEXT }),
    makeMessage({ id: "e2", content: "va sur https://evil.example", channelId: CH_TEXT }),
  );
  assert.equal(edited.matched, false, "l'exemption du salon s'applique à l'édition");
  assert.equal(edited.code, "AUTOMOD_IGNORED");
  assert.equal(h.enforcerCalls.deleted.length, 0, "aucune suppression");
  assert.equal(h.moderationLogs.length, 0, "aucun log");
});

test("32. messageUpdate : auteur avec rôle exempt édité vers un lien → ignoré", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [ROLE_A], automod_exempt_channels: [] },
  });
  const edited = await h.runtime.handleMessageEdited(
    makeMessage({ id: "e3", content: "bonjour", roles: [ROLE_A] }),
    makeMessage({ id: "e3", content: "https://evil.example", roles: [ROLE_A] }),
  );
  assert.equal(edited.code, "AUTOMOD_IGNORED");
  assert.equal(h.enforcerCalls.deleted.length, 0);
  assert.equal(h.moderationLogs.length, 0);
});

test("33. messageUpdate : garde P1 préservée en salon exempt — inchangé/partiel = IGNORED sans exécution", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_anti_spam: true, automod_delete_message: true, automod_exempt_channels: [CH_TEXT] },
  });
  const complete = makeMessage({ id: "e4", content: "https://evil.example", channelId: CH_TEXT });
  // Contenu inchangé → garde P1 (avant même l'exemption).
  const unchanged = await h.runtime.handleMessageEdited(complete, complete);
  assert.equal(unchanged.code, "AUTOMOD_IGNORED");
  // Partiel → abstention P1.
  const partial = await h.runtime.handleMessageEdited({ ...complete, partial: true }, complete);
  assert.equal(partial.code, "AUTOMOD_IGNORED");
  assert.equal(h.store.size, 0, "aucune exécution n'a atteint la détection");
  assert.equal(h.enforcerCalls.deleted.length, 0);
  assert.equal(h.moderationLogs.length, 0);
});

test("34. messageUpdate : contrôle — édition vers un lien HORS salon exempt toujours sanctionnée", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_channels: [CH_TEXT] },
  });
  const edited = await h.runtime.handleMessageEdited(
    makeMessage({ id: "e5", content: "bonjour", channelId: CH_DEFAULT }),
    makeMessage({ id: "e5", content: "https://evil.example", channelId: CH_DEFAULT }),
  );
  assert.equal(edited.matched, true);
  assert.equal(edited.code, "AUTOMOD_LINK");
  assert.deepEqual(h.enforcerCalls.deleted, ["e5"]);
  assert.equal(h.moderationLogs.length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// NON-RÉGRESSION (35–45)
// ════════════════════════════════════════════════════════════════════════════

test("35. non-régression : bot toujours ignoré (AVANT toute exemption), 0 log", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [ROLE_A], automod_exempt_channels: [CH_TEXT] },
  });
  const r = await h.runtime.handleMessage(makeMessage({ id: "b1", content: "https://evil.example", bot: true, roles: [ROLE_A], channelId: CH_TEXT }));
  assert.equal(r.matched, false);
  assert.equal(r.code, "AUTOMOD_IGNORED");
  assert.equal(h.moderationLogs.length, 0);
  assert.equal(h.store.size, 0);
});

test("36. non-régression : administrator inchangé (matched=false, aucune sanction)", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [ROLE_A], automod_exempt_channels: [CH_TEXT] },
  });
  const r = await h.runtime.handleMessage(makeMessage({ id: "a1", content: "https://evil.example", admin: true }));
  assert.equal(r.matched, false);
  assert.equal(h.enforcerCalls.deleted.length, 0);
  assert.equal(h.moderationLogs.length, 0);
});

test("37. non-régression : ManageMessages inchangé (matched=false, aucune sanction)", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [ROLE_A], automod_exempt_channels: [CH_TEXT] },
  });
  const r = await h.runtime.handleMessage(makeMessage({ id: "mm1", content: "https://evil.example", manageMessages: true }));
  assert.equal(r.matched, false);
  assert.equal(h.enforcerCalls.deleted.length, 0);
  assert.equal(h.moderationLogs.length, 0);
});

test("38. non-régression : les 7 règles et leur priorité restent intactes", async () => {
  // A — règles individuelles + priorité LINK > INVITE, compteur spam OFF
  // pour que l'historique n'interfère pas avec les codes individuels.
  const rulesOff = {
    automod_anti_spam: false,
    automod_anti_links: true,
    automod_anti_invites: true,
    automod_anti_mention_spam: true,
    automod_mention_threshold: 5,
    automod_anti_emoji_spam: true,
    automod_emoji_threshold: 8,
    automod_anti_caps: true,
    automod_caps_threshold: 70,
    automod_bad_words: ["stupide"],
    automod_delete_message: false,
    automod_exempt_roles: [],
    automod_exempt_channels: [],
  };
  const h = makeHarness({ config: rulesOff });
  const detect = async (id, content, extra = {}) => (await h.runtime.handleMessage(makeMessage({ id, content, ...extra }))).code;

  assert.equal(await detect("r1", "va sur https://evil.example"), "AUTOMOD_LINK");
  assert.equal(await detect("r2", "rejoins discord.gg/abcdef"), "AUTOMOD_INVITE");
  assert.equal(await detect("r3", "@a @b @c @d @e @f salut", { mentionCount: 6 }), "AUTOMOD_MENTION_SPAM");
  assert.equal(await detect("r4", "<:e:1><:e:1><:e:1><:e:1><:e:1><:e:1><:e:1><:e:1><:e:1>"), "AUTOMOD_EMOJI_SPAM");
  assert.equal(await detect("r5", "BIEN SUR QUE OUI"), "AUTOMOD_CAPS");
  assert.equal(await detect("r6", "quel imbécile, quelle idée stupide"), "AUTOMOD_BAD_WORD");
  assert.equal(await detect("p1", "https://evil.example et discord.gg/abcdef"), "AUTOMOD_LINK", "LINK prime sur INVITE");

  // B — priorité SPAM > LINK : flood contenant des liens → SPAM en tête.
  const spamFirst = makeHarness({ config: { ...rulesOff, automod_anti_spam: true } });
  let spamCode = null;
  for (let i = 1; i <= 5; i++) {
    spamCode = (await spamFirst.runtime.handleMessage(makeMessage({ id: `sp${i}`, content: `https://evil.example wave ${i}` }))).code;
  }
  assert.equal(spamCode, "AUTOMOD_SPAM", "SPAM prime sur LINK");
});

test("39. non-régression : sanction + log inchangés hors exemption (delete + log automod)", async () => {
  const h = makeHarness({
    config: { automod_anti_links: true, automod_delete_message: true, automod_exempt_roles: [], automod_exempt_channels: [] },
  });
  const r = await h.runtime.handleMessage(makeMessage({ id: "n1", content: "https://evil.example" }));
  assert.equal(r.matched, true);
  assert.deepEqual(h.enforcerCalls.deleted, ["n1"]);
  assert.equal(h.moderationLogs.length, 1);
  assert.equal(h.moderationLogs[0].rule, "AUTOMOD_LINK");
});

test("40. non-régression : AutoModConfigService historique inchangé (contrat, defaults, update)", async () => {
  assert.throws(() => new AutoModConfigService({}), /guildConfigResolver/);
  let config = {};
  const service = new AutoModConfigService({
    guildConfigResolver: { get: async () => config, update: async (g, patch) => (config = { ...config, ...patch }) },
  });
  const read = await service.read("g");
  assert.equal(read.automod_enabled, false);
  assert.equal(read.automod_delete_message, true, "défaut delete_message inchangé");
  assert.deepEqual(read.automod_bad_words, []);
  assert.equal(read.automod_punishment, "none");
  await service.update("g", { automod_enabled: true });
  assert.equal(config.automod_enabled, true, "update écrit toujours à travers le resolver");
  assert.deepEqual(normalizeExemptList(undefined), [], "helper de normalisation exporté");
});

test("41. non-régression : panneau + sous-vue Exemptions dans les limites Discord", () => {
  const t = (key) => key;
  const panel = autoModView({ t, config: {} });
  const panelIds = panel.components.map((c) => c.customId).filter(Boolean);
  assert.ok(panelIds.includes(Id.EXEMPT_OPEN), "entrée Exemptions dans le panneau");
  assert.ok(panelIds.includes(Id.ENFORCE_SELECT) && panelIds.includes(Id.BACK), "contrôles historiques préservés");
  const panelRows = rows(panel.components);
  assert.ok(panelRows.length <= MAX_ACTION_ROWS, `panneau : ${panelRows.length} rows ≤ ${MAX_ACTION_ROWS}`);

  const sub = autoModExemptView({ t, config: { automod_exempt_roles: [ROLE_A], automod_exempt_channels: [CH_TEXT] } });
  const types = sub.components.map((c) => c.type);
  assert.ok(types.includes("role-select"), "select rôles natif");
  assert.ok(types.includes("channel-select"), "select salons natif");
  const subIds = sub.components.map((c) => c.customId);
  for (const id of [Id.EXEMPT_RESET_ROLES, Id.EXEMPT_RESET_CHANNELS, Id.EXEMPT_BACK]) assert.ok(subIds.includes(id), `manque ${id}`);
  const subRows = rows(sub.components);
  assert.ok(subRows.length <= MAX_ACTION_ROWS, `sous-vue : ${subRows.length} rows ≤ ${MAX_ACTION_ROWS}`);

  // Rendu réel du transport : builders Discord valides, channelTypes [0,5].
  const rendered = JSON.stringify(renderView(sub));
  assert.match(rendered, /"channel_types":\[0,5\]/);
  const roleSelect = sub.components.find((c) => c.type === "role-select");
  assert.equal(roleSelect.maxValues, 10, "multi-sélection rôles plafonnée à 10");
  assert.equal(roleSelect.minValues, 1);
});

test("42. non-régression : registerAutoMod route les interactions Exemptions SANS nouvelle route", async () => {
  const registry = new InteractionRegistry();
  const service = makeService({ automod_anti_links: false });
  const registration = registerAutoMod({ registry, service, settingsHome: async () => {} });

  // ① ZÉRO nouvelle route : le module n'enregistre que la surface historique
  //    (7 boutons, 1 select merge, 2 modales) — compteurs Phase 0 préservés.
  assert.equal(registry.componentRoutes.get("button").length, 7, "boutons : surface historique inchangée (aucun +1)");
  assert.equal(registry.componentRoutes.get("select-menu").length, 1, "selects : UNE seule route mergee (enforce + exemptions)");
  assert.equal(registry.componentRoutes.get("modal").length, 2, "modales inchangées");

  // ② Les 6 customIds exempt trouvent une route via les matchers existants.
  for (const customId of [Id.EXEMPT_OPEN, Id.EXEMPT_BACK, Id.EXEMPT_RESET_ROLES, Id.EXEMPT_RESET_CHANNELS]) {
    const route = registry.find({ kind: "button", customId });
    assert.ok(route, `route button manquante : ${customId}`);
    assert.deepEqual(route.permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }
  for (const customId of [Id.EXEMPT_ROLES_SELECT, Id.EXEMPT_CHANNELS_SELECT]) {
    const route = registry.find({ kind: "select-menu", customId });
    assert.ok(route, `route select manquante : ${customId}`);
    assert.deepEqual(route.permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }

  // ③ Dispatch fonctionnel des routes mergees (réel execute du registre).
  const makeRouteContext = ({ customId, values = [], guild = makeGuild({ roles: [ROLE_A], channels: [[CH_TEXT, { type: 0 }]] }) }) => {
    const renders = [];
    return {
      renders,
      ctx: {
        guildId: GUILD,
        userId: "700000000000000009",
        t: (key) => key,
        envelope: {
          customId,
          values,
          discordMember: { guild },
          transport: {
            update: async (payload) => renders.push(payload),
            reply: async () => {},
          },
        },
        service,
        rateLimitGuard: allowGuard,
      },
    };
  };

  // ③a bouton exempt-open → rend la sous-vue (role-select/channel-select natifs).
  const buttonRoute = registry.find({ kind: "button", customId: Id.EXEMPT_OPEN });
  const open = makeRouteContext({ customId: Id.EXEMPT_OPEN });
  await buttonRoute.execute(open.ctx);
  assert.equal(open.renders.length, 1, "exempt-open rend une vue");
  const openTypes = (open.renders[0].view.components || []).map((c) => c.type);
  assert.ok(openTypes.includes("role-select") && openTypes.includes("channel-select"), "sous-vue native rôles+salons");

  // ③b select exemptions rôles → écriture validée via la route mergee.
  const selectRoute = registry.find({ kind: "select-menu", customId: Id.EXEMPT_ROLES_SELECT });
  const roles = makeRouteContext({ customId: Id.EXEMPT_ROLES_SELECT, values: [ROLE_A] });
  await selectRoute.execute(roles.ctx);
  assert.deepEqual(service.writes.at(-1), { automod_exempt_roles: [ROLE_A] }, "écriture rôles via route mergee");

  // ③c select exemptions salons → écriture validée via la même route mergee.
  const channels = makeRouteContext({ customId: Id.EXEMPT_CHANNELS_SELECT, values: [CH_TEXT] });
  await selectRoute.execute(channels.ctx);
  assert.deepEqual(service.writes.at(-1), { automod_exempt_channels: [CH_TEXT] }, "écriture salons via route mergee");

  // ③d ENFORCE_SELECT (legacy) → même route, branche historique préservée.
  const enforce = makeRouteContext({ customId: Id.ENFORCE_SELECT, values: ["timeout"] });
  await selectRoute.execute(enforce.ctx);
  assert.deepEqual(service.writes.at(-1), { automod_punishment: "timeout" }, "branche enforcement historique intacte");
  assert.equal(enforce.renders.length, 1, "le panneau AutoMod est re-rendu");

  // ③e toggle de règle legacy via la même route prefix bouton.
  const legacy = makeRouteContext({ customId: `${Id.TOGGLE_PREFIX}:antiLinks` });
  await buttonRoute.execute(legacy.ctx);
  assert.deepEqual(service.writes.at(-1), { automod_anti_links: true }, "toggle de règle historique intact");

  // ③f reset rôles via la route prefix bouton → [].
  const resetRoute = registry.find({ kind: "button", customId: Id.EXEMPT_RESET_ROLES });
  const reset = makeRouteContext({ customId: Id.EXEMPT_RESET_ROLES });
  await resetRoute.execute(reset.ctx);
  assert.deepEqual(service.writes.at(-1), { automod_exempt_roles: [] }, "reset via route prefix");

  // ③g bouton retour → panneau historique.
  const backRoute = registry.find({ kind: "button", customId: Id.EXEMPT_BACK });
  const back = makeRouteContext({ customId: Id.EXEMPT_BACK });
  await backRoute.execute(back.ctx);
  const backIds = (back.renders[0].view.components || []).map((c) => c.customId).filter(Boolean);
  assert.ok(backIds.includes(Id.ENFORCE_SELECT) && backIds.includes(Id.BACK), "retour = panneau AutoMod historique");
  assert.ok(!backIds.includes(Id.EXEMPT_ROLES_SELECT), "la sous-vue n'est plus affichée");

  // ④ Structure historique préservée : section + commande.
  assert.ok(registry.find({ kind: "button", customId: Id.SECTION }));
  assert.equal(registration.commands.length, 1);
  assert.equal(registration.commands[0].name, "automod");
});

test("43. non-régression : i18n AutoMod — parité FR/EN et clés exempt résolues", () => {
  const { validateTranslationParity, I18nService } = require("../../../core/i18n");
  const en = require("../translations/en.json");
  const fr = require("../translations/fr.json");
  assert.equal(validateTranslationParity({ en, fr }), true);
  const keys = ["exemptOpen", "exemptHelp", "exemptRoles", "exemptChannels", "exemptResetRoles", "exemptResetChannels"];
  for (const key of keys) {
    assert.ok(fr.automod[key], `fr.automod.${key} manquant`);
    assert.ok(en.automod[key], `en.automod.${key} manquant`);
  }
  const i18n = new I18nService({ dictionaries: { en, fr } });
  assert.equal(i18n.forLocale("fr")("automod.exemptOpen"), "Exemptions");
  assert.equal(i18n.forLocale("en")("automod.exemptOpen"), "Exemptions");
});

test("44. non-régression : events messageCreate/messageUpdate intouchés (logique dans le runtime seul)", () => {
  const createSource = fs.readFileSync("src/events/messageCreate.js", "utf8");
  const updateSource = fs.readFileSync("src/events/messageUpdate.js", "utf8");
  for (const [label, source] of [["messageCreate", createSource], ["messageUpdate", updateSource]]) {
    assert.match(source, /getAutoModRuntime/, `${label} garde son câblage AutoMod`);
    assert.doesNotMatch(source, /exempt/i, `${label} ne contient AUCUNE logique d'exemption (choke point runtime)`);
  }
  assert.match(updateSource, /handleMessageEdited/);
  assert.match(createSource, /handleMessage/);
});

test("45. non-régression : flag detect — exempt=true IGNORED avant règles/store ; false/absent = legacy", () => {
  const { clock } = makeClock();
  const store = new Map();
  const svc = new AutoModDetectionService({ clock, store });
  const config = { automod_enabled: true, automod_anti_links: true, automod_anti_spam: true };

  const ignored = svc.detect({ config, exempt: true, guildId: GUILD, authorId: AUTHOR, content: "https://evil.example", mentionCount: 0 });
  assert.equal(ignored.matched, false);
  assert.equal(ignored.code, "AUTOMOD_IGNORED");
  assert.deepEqual(ignored.rules, []);
  assert.equal(store.size, 0, "aucune entrée spam pour exempt=true");

  const flaggedOff = svc.detect({ config, exempt: false, guildId: GUILD, authorId: AUTHOR, content: "https://evil.example", mentionCount: 0 });
  assert.equal(flaggedOff.matched, true, "exempt=false → comportement legacy");
  assert.equal(flaggedOff.code, "AUTOMOD_LINK");

  const noFlag = svc.detect({ config, guildId: GUILD, authorId: AUTHOR, content: "texte propre", mentionCount: 0 });
  assert.equal(noFlag.matched, false);
  assert.equal(noFlag.code, "AUTOMOD_NO_MATCH", "sans flag → legacy intégral");

  // L'aide isExemptFromAutoMod est exportée pour le runtime ET les tests.
  assert.equal(typeof isExemptFromAutoMod, "function");
  assert.equal(isExemptFromAutoMod({ config: {}, member: null, channelId: null, guildId: GUILD }), false, "listes vides = jamais exempt");
});
