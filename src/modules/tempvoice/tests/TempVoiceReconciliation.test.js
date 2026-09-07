"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TempVoiceReconciliationService,
  isUnknownChannelError,
} = require("../services/TempVoiceReconciliationService");
const { createTempVoiceRuntime } = require("../runtime/createTempVoiceRuntime");
const { InMemoryTempVoiceRepository } = require("../persistence/TempVoiceRepository");

// ─────────────────────────────────────────────────────────────────────────────
// Faux objets (aucun discord.js : on évalue le comportement, pas la librairie).
// ─────────────────────────────────────────────────────────────────────────────

function makeChannel({ id = "ch", type = 2, members = { size: 0 }, deleteFn } = {}) {
  return {
    id,
    type,
    members,
    delete: deleteFn || (async () => {}),
  };
}

function makeGuild({ id = "g1", channels = {}, fetchImpl = null, fetchError = null } = {}) {
  return {
    id,
    channels: {
      fetch:
        fetchImpl ||
        (async (channelId) => {
          if (fetchError) throw fetchError;
          return channels[channelId] || null;
        }),
    },
  };
}

function makeClient(guilds) {
  return { guilds: { cache: guilds } };
}

function makeRepository(rows = [], { findByGuildImpl, deleteImpl } = {}) {
  const deleted = [];
  return {
    findByGuild:
      findByGuildImpl ||
      (async (guildId) => rows.filter((row) => row.guildId === guildId)),
    delete:
      deleteImpl ||
      (async (guildId, channelId) => {
        deleted.push({ guildId, channelId });
      }),
    _deleted: deleted,
  };
}

function makeLogger() {
  const logs = [];
  return {
    logs,
    info: (message, meta) => logs.push({ level: "info", message, meta }),
    warn: (message, meta) => logs.push({ level: "warn", message, meta }),
    error: (message, meta) => logs.push({ level: "error", message, meta }),
  };
}

const row = (guildId, channelId) => ({ guildId, channelId, ownerId: "u1", lobbyId: "lobby" });

// ─────────────────────────────────────────────────────────────────────────────
// Service : orphelin / vide / non vide / ordre
// ─────────────────────────────────────────────────────────────────────────────

test("B5-c — salon absent Discord → ligne DB supprimée, aucun channel.delete()", async () => {
  let discordDeletes = 0;
  const repo = makeRepository([row("g1", "gone")]);
  const guild = makeGuild({ id: "g1", channels: {} }); // fetch → null
  const service = new TempVoiceReconciliationService({
    repository: repo,
    client: makeClient([guild]),
  });

  const result = await service.reconcile();

  assert.equal(result.removedOrphanRows, 1);
  assert.equal(result.deletedEmptyChannels, 0);
  assert.equal(result.skipped, 0);
  assert.deepEqual(repo._deleted, [{ guildId: "g1", channelId: "gone" }]);
  assert.equal(discordDeletes, 0);
});

test("B5-c — salon existant mais non vide → jamais supprimé, signalé survivant", async () => {
  let discordDeletes = 0;
  const channel = makeChannel({ id: "kept", members: { size: 3 }, deleteFn: async () => { discordDeletes++; } });
  const repo = makeRepository([row("g1", "kept")]);
  const guild = makeGuild({ id: "g1", channels: { kept: channel } });
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]) });

  const result = await service.reconcile();

  assert.equal(discordDeletes, 0);
  assert.deepEqual(repo._deleted, []);
  assert.equal(result.rehydrated, 1);
  assert.deepEqual(result.survivors, ["kept"]);
});

test("B5-c — salon existant et vide → Discord delete PUIS DB delete (ordre vérifié)", async () => {
  const callLog = [];
  const channel = makeChannel({ id: "empty", members: { size: 0 }, deleteFn: async () => { callLog.push("discord:delete"); } });
  const repo = makeRepository([row("g1", "empty")], {
    deleteImpl: async (guildId, channelId) => { callLog.push("db:delete"); },
  });
  const guild = makeGuild({ id: "g1", channels: { empty: channel } });
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]) });

  const result = await service.reconcile();

  assert.equal(result.deletedEmptyChannels, 1);
  assert.deepEqual(callLog, ["discord:delete", "db:delete"], "Discord doit être supprimé avant la ligne DB");
});

test("B5-c — un salon non référencé dans la table n'est jamais touché", async () => {
  let discordDeletes = 0;
  // Le salon "unrelated" existe côté Discord mais n'a AUCUNE ligne dans le dépôt.
  const unrelated = makeChannel({ id: "unrelated", members: { size: 0 }, deleteFn: async () => { discordDeletes++; } });
  const repo = makeRepository([]); // table vide
  const guild = makeGuild({ id: "g1", channels: { unrelated } });
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]) });

  const result = await service.reconcile();

  assert.equal(discordDeletes, 0, "un salon hors table ne doit jamais être supprimé");
  assert.equal(result.rowsProcessed, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Service : pannes (Discord / Supabase)
// ─────────────────────────────────────────────────────────────────────────────

test("B5-c — panne Discord non-404 → rien supprimé (aucune conclusion d'orphelin)", async () => {
  const repo = makeRepository([row("g1", "ch")]);
  const guild = makeGuild({ id: "g1", fetchError: Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }) });
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]) });

  const result = await service.reconcile();

  assert.deepEqual(repo._deleted, []);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors[0].reason, "DISCORD_UNAVAILABLE");
});

test("B5-c — un 404 / Unknown Channel (10003) est bien un orphelin, pas une panne", async () => {
  assert.equal(isUnknownChannelError({ code: 10003 }), true);
  assert.equal(isUnknownChannelError({ code: "ECONNREFUSED" }), false);
  assert.equal(isUnknownChannelError({ code: 50013 }), false);

  const repo = makeRepository([row("g1", "ch")]);
  const guild = makeGuild({ id: "g1", fetchError: Object.assign(new Error("Unknown Channel"), { code: 10003 }) });
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]) });

  const result = await service.reconcile();
  assert.equal(result.removedOrphanRows, 1);
  assert.deepEqual(repo._deleted, [{ guildId: "g1", channelId: "ch" }]);
});

test("B5-c — panne Supabase (findByGuild lève) → rien supprimé", async () => {
  const repo = makeRepository([], {
    findByGuildImpl: async () => { throw new Error("supabase down"); },
  });
  const guild = makeGuild({ id: "g1" });
  const logger = makeLogger();
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]), logger });

  const result = await service.reconcile();

  assert.deepEqual(repo._deleted, []);
  assert.equal(result.errors[0].reason, "SUPABASE_UNAVAILABLE");
  assert.ok(logger.logs.some((entry) => entry.level === "warn"));
});

test("B5-c — la suppression Discord qui échoue conserve la ligne DB", async () => {
  const channel = makeChannel({
    id: "ch",
    members: { size: 0 },
    deleteFn: async () => { throw new Error("Missing Permissions"); },
  });
  const repo = makeRepository([row("g1", "ch")]);
  const guild = makeGuild({ id: "g1", channels: { ch: channel } });
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]) });

  const result = await service.reconcile();

  assert.deepEqual(repo._deleted, []);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors[0].reason, "DISCORD_DELETE_FAILED");
});

// ─────────────────────────────────────────────────────────────────────────────
// Service : ligne invalide / type non-voice / vacuité indéterminable
// ─────────────────────────────────────────────────────────────────────────────

test("B5-c — ligne DB invalide → skip + log, jamais de suppression", async () => {
  const repo = makeRepository([{ guildId: "g1", channelId: null }]);
  const guild = makeGuild({ id: "g1" });
  const logger = makeLogger();
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]), logger });

  const result = await service.reconcile();

  assert.deepEqual(repo._deleted, []);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors[0].reason, "INVALID_ROW");
  assert.ok(logger.logs.some((entry) => entry.meta && entry.meta.reason === "INVALID_ROW"));
});

test("B5-c — un salon non-voice (type ≠ GuildVoice) n'est pas supprimé", async () => {
  let discordDeletes = 0;
  const channel = makeChannel({ id: "text", type: 0, members: { size: 0 }, deleteFn: async () => { discordDeletes++; } });
  const repo = makeRepository([row("g1", "text")]);
  const guild = makeGuild({ id: "g1", channels: { text: channel } });
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]) });

  const result = await service.reconcile();

  assert.equal(discordDeletes, 0);
  assert.deepEqual(repo._deleted, []);
  assert.equal(result.errors[0].reason, "NOT_GUILD_VOICE");
});

test("B5-c — vacuité indéterminable (members absent) → skip sans suppression", async () => {
  let discordDeletes = 0;
  const channel = makeChannel({ id: "ch", deleteFn: async () => { discordDeletes++; } });
  delete channel.members; // simule un salon partiel sans membres lisibles
  const repo = makeRepository([row("g1", "ch")]);
  const guild = makeGuild({ id: "g1", channels: { ch: channel } });
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]) });

  const result = await service.reconcile();

  assert.equal(discordDeletes, 0);
  assert.deepEqual(repo._deleted, []);
  assert.equal(result.errors[0].reason, "MEMBERSHIP_UNKNOWN");
});

// ─────────────────────────────────────────────────────────────────────────────
// Service : cross-guild isolation + double run
// ─────────────────────────────────────────────────────────────────────────────

test("B5-c — isolation stricte : les lignes d'une autre guilde ne sont jamais touchées", async () => {
  const repo = makeRepository([row("g1", "a"), row("g2", "b")]);
  const guild1 = makeGuild({ id: "g1", channels: {} }); // "a" → orphelin dans g1
  const guild2 = makeGuild({ id: "g2", channels: { b: makeChannel({ id: "b", members: { size: 1 } }) } }); // "b" non vide dans g2
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild1, guild2]) });

  await service.reconcile();

  assert.deepEqual(repo._deleted, [{ guildId: "g1", channelId: "a" }], "seule la ligne de g1 est traitée");
});

test("B5-c — double exécution idempotente au niveau données", async () => {
  let discordDeletes = 0;
  let rows = [row("g1", "empty")];
  const channel = makeChannel({ id: "empty", members: { size: 0 }, deleteFn: async () => { discordDeletes++; } });
  const repo = {
    findByGuild: async () => rows,
    delete: async (guildId, channelId) => {
      rows = rows.filter((r) => !(r.guildId === guildId && r.channelId === channelId));
    },
  };
  const guild = makeGuild({ id: "g1", channels: { empty: channel } });
  const service = new TempVoiceReconciliationService({ repository: repo, client: makeClient([guild]) });

  const first = await service.reconcile();
  const second = await service.reconcile();

  assert.equal(first.deletedEmptyChannels, 1);
  assert.equal(second.rowsProcessed, 0, "le second passage ne retrouve plus de ligne");
  assert.equal(discordDeletes, 1, "un seul channel.delete() au total");
});

// ─────────────────────────────────────────────────────────────────────────────
// Runtime : ré-hydratation, garde double-run, InMemory, wiring
// ─────────────────────────────────────────────────────────────────────────────

function makeConfigService() {
  return { read: async () => ({ tempvoice_enabled: false }) };
}

test("B5-c — le runtime réinjecte les survivants dans le Set partagé", async () => {
  const shared = new Set();
  const configService = makeConfigService();
  const runtime = createTempVoiceRuntime({
    configService,
    tempChannels: shared,
    repository: new InMemoryTempVoiceRepository(),
    reconciliationServiceFactory: () => ({
      reconcile: async () => ({ survivors: ["kept1", "kept2"], errors: [] }),
    }),
    logger: makeLogger(),
  });

  const result = await runtime.reconcileOnStartup(makeClient([makeGuild({ id: "g1" })]));

  assert.equal(result.code, "TEMPVOICE_RECONCILED");
  assert.ok(shared.has("kept1"));
  assert.ok(shared.has("kept2"));
});

test("B5-c — le runtime garde contre un double run", async () => {
  let runs = 0;
  const runtime = createTempVoiceRuntime({
    configService: makeConfigService(),
    repository: new InMemoryTempVoiceRepository(),
    reconciliationServiceFactory: () => ({
      reconcile: async () => { runs++; return { survivors: [], errors: [] }; },
    }),
    logger: makeLogger(),
  });

  const first = await runtime.reconcileOnStartup(makeClient([]));
  const second = await runtime.reconcileOnStartup(makeClient([]));

  assert.equal(first.code, "TEMPVOICE_RECONCILED");
  assert.equal(second.code, "TEMPVOICE_RECONCILE_ALREADY_RUN");
  assert.equal(runs, 1, "le service n'est exécuté qu'une seule fois");
});

test("B5-c — le runtime reste fonctionnel avec un repository InMemory (fallback)", async () => {
  const runtime = createTempVoiceRuntime({
    configService: makeConfigService(),
    repository: new InMemoryTempVoiceRepository(),
    logger: makeLogger(),
  });

  // Aucun salon Discord, aucune ligne → ne lève pas, résultat neutre.
  const result = await runtime.reconcileOnStartup(makeClient([makeGuild({ id: "g1" })]));
  assert.equal(result.code, "TEMPVOICE_RECONCILED");
  assert.equal(result.result.rowsProcessed, 0);
});

test("B5-c — le runtime expose le wiring de réconciliation (service + config)", async () => {
  const configService = makeConfigService();
  const repo = new InMemoryTempVoiceRepository();
  const runtime = createTempVoiceRuntime({ configService, repository: repo, logger: makeLogger() });

  assert.equal(typeof runtime.reconcileOnStartup, "function");
  assert.equal(runtime._repository, repo);
  assert.equal(runtime._configService, configService);
});

test("B5-c — tempvoice_enabled=false ne bloque pas le cleanup (décision B)", async () => {
  // Le service ne lit JAMAIS le toggle : il traite les lignes telles quelles.
  const configService = { read: async () => ({ tempvoice_enabled: false }) };
  const repo = makeRepository([row("g1", "gone")]);
  const guild = makeGuild({ id: "g1", channels: {} });
  const runtime = createTempVoiceRuntime({
    configService,
    repository: repo,
    reconciliationServiceFactory: (client) => new TempVoiceReconciliationService({ repository: repo, client, logger: makeLogger() }),
    logger: makeLogger(),
  });

  const result = await runtime.reconcileOnStartup(makeClient([guild]));

  assert.equal(result.code, "TEMPVOICE_RECONCILED");
  assert.equal(result.result.removedOrphanRows, 1, "cleanup effectué malgré tempvoice_enabled=false");
});
