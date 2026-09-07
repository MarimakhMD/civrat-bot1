"use strict";

// B5-b — Dépôt TempVoice sur public.temp_voice_channels.
//
// Le faux client conserve de vraies lignes et ÉVALUE les filtres transmis :
// si le dépôt envoie un mauvais filtre (ex. sans guild_id), le test échoue.
// C'est ce qui prouve le cloisonnement strict par guilde.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SupabaseTempVoiceRepository,
  TempVoiceUnavailableError,
  TEMP_VOICE_TABLE,
} = require("../persistence/SupabaseTempVoiceRepository");
const { InMemoryTempVoiceRepository } = require("../persistence/TempVoiceRepository");
const { TempVoiceService } = require("../services/TempVoiceService");

/** Faux client Supabase simulant public.temp_voice_channels. */
function createFakeSupabase({ errors = {} } = {}) {
  const rows = new Map(); // "guild:channel" -> ligne snake_case
  const calls = [];
  let injected = { ...errors };

  const keyOf = (g, c) => `${g}:${c}`;

  function matches(row, filters) {
    return filters.every((f) => (f.type === "eq" ? row[f.column] === f.value : true));
  }

  function execute(state) {
    calls.push({ mode: state.mode || "select", filters: state.filters.map((f) => ({ ...f })) });
    if (injected[state.mode || "select"]) {
      const err = injected[state.mode || "select"];
      if (err === "once") delete injected[state.mode || "select"];
      return Promise.resolve({ data: null, error: injected[state.mode || "select"] || err });
    }
    if (state.mode === "insert") {
      const key = keyOf(state.payload.guild_id, state.payload.channel_id);
      if (rows.has(key)) {
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });
      }
      const row = {
        guild_id: state.payload.guild_id,
        channel_id: state.payload.channel_id,
        owner_id: state.payload.owner_id,
        lobby_id: state.payload.lobby_id,
        created_at: "2026-01-01T00:00:00.000Z",
      };
      rows.set(key, row);
      // `.select()` PostgREST renvoie un TABLEAU (une ligne) ; `.maybeSingle()`
      // le déroule ensuite en objet unique.
      return Promise.resolve({ data: [{ ...row }], error: null });
    }
    if (state.mode === "delete") {
      for (const [key, row] of [...rows]) {
        if (matches(row, state.filters)) rows.delete(key);
      }
      return Promise.resolve({ data: null, error: null });
    }
    // lecture
    const result = [...rows.values()].filter((row) => matches(row, state.filters));
    return Promise.resolve({ data: result.map((r) => ({ ...r })), error: null });
  }

  function from(table) {
    assert.equal(table, TEMP_VOICE_TABLE, "le dépôt doit viser public.temp_voice_channels");
    const state = { filters: [], mode: null, payload: null };
    const api = {
      select() { return api; },
      eq(column, value) { state.filters.push({ type: "eq", column, value }); return api; },
      insert(payload) { state.mode = "insert"; state.payload = payload; return api; },
      delete() { state.mode = "delete"; return api; },
      async maybeSingle() {
        const { data, error } = await execute(state);
        if (error) return { data: null, error };
        if (!Array.isArray(data) || data.length === 0) return { data: null, error: null };
        return { data: data[0], error: null };
      },
      then(resolve, reject) { return execute(state).then(resolve, reject); },
    };
    return api;
  }

  return {
    client: { from },
    rows,
    calls,
    inject(mode, error) { injected[mode] = error; },
    clearErrors() { injected = {}; },
  };
}

const record = (g, c, o = "u", l = "lobby") => ({ guildId: g, channelId: c, ownerId: o, lobbyId: l });

// ─────────────────────────────────────────────────────────────────────────
// create / persist / read / delete
// ─────────────────────────────────────────────────────────────────────────

test("B5-b — create persiste guild_id, channel_id, owner_id, lobby_id", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTempVoiceRepository({ supabase: fake.client });

  const saved = await repo.create(record("g1", "c1", "u1", "lobby1"));

  assert.deepEqual(saved, {
    guildId: "g1", channelId: "c1", ownerId: "u1", lobbyId: "lobby1", createdAt: "2026-01-01T00:00:00.000Z",
  });
  const stored = fake.rows.get("g1:c1");
  assert.equal(stored.guild_id, "g1");
  assert.equal(stored.channel_id, "c1");
  assert.equal(stored.owner_id, "u1");
  assert.equal(stored.lobby_id, "lobby1");
});

test("B5-b — findByChannel lit un salon précis dans sa guilde", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTempVoiceRepository({ supabase: fake.client });
  await repo.create(record("g1", "c1", "u1"));

  const found = await repo.findByChannel("g1", "c1");
  assert.equal(found.channelId, "c1");
  assert.equal(found.ownerId, "u1");

  assert.equal(await repo.findByChannel("g1", "missing"), null, "salon absent → null");
  assert.equal(await repo.findByChannel("g2", "c1"), null, "salon d'une autre guilde → null");
});

test("B5-b — findByGuild liste uniquement les salons de la guilde", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTempVoiceRepository({ supabase: fake.client });
  await repo.create(record("g1", "c1"));
  await repo.create(record("g1", "c2"));
  await repo.create(record("g2", "c3"));

  const g1 = await repo.findByGuild("g1");
  assert.deepEqual(g1.map((r) => r.channelId).sort(), ["c1", "c2"]);
});

test("B5-b — delete supprime le suivi, scopé par guild_id", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTempVoiceRepository({ supabase: fake.client });
  await repo.create(record("g1", "c1"));
  await repo.create(record("g2", "c1"));

  await repo.delete("g1", "c1");
  assert.equal(await repo.findByChannel("g1", "c1"), null, "le salon g1 est supprimé");
  assert.ok(await repo.findByChannel("g2", "c1"), "le salon homonyme de g2 est intact");
});

// ─────────────────────────────────────────────────────────────────────────
// cross-guild isolation (au niveau des requêtes émises)
// ─────────────────────────────────────────────────────────────────────────

test("B5-b — chaque opération porte le filtre guild_id (cloisonnement strict)", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTempVoiceRepository({ supabase: fake.client });

  await repo.findByChannel("g1", "c1");
  await repo.findByGuild("g1");
  await repo.delete("g1", "c1");

  const read = fake.calls[0];
  assert.ok(read.filters.some((f) => f.type === "eq" && f.column === "guild_id" && f.value === "g1"),
    "findByChannel doit filtrer sur guild_id");
  const list = fake.calls[1];
  assert.ok(list.filters.some((f) => f.type === "eq" && f.column === "guild_id"),
    "findByGuild doit filtrer sur guild_id");
  const del = fake.calls[2];
  assert.ok(del.filters.some((f) => f.type === "eq" && f.column === "guild_id" && f.value === "g1"),
    "delete doit filtrer sur guild_id");
});

// ─────────────────────────────────────────────────────────────────────────
// erreurs classifiées
// ─────────────────────────────────────────────────────────────────────────

test("B5-b — 42P01 signale une table absente de façon distinguable", async () => {
  const fake = createFakeSupabase();
  fake.inject("insert", { code: "42P01", message: 'relation "public.temp_voice_channels" does not exist' });
  const repo = new SupabaseTempVoiceRepository({ supabase: fake.client });

  await assert.rejects(() => repo.create(record("g", "c")), (error) => {
    assert.ok(error instanceof TempVoiceUnavailableError);
    assert.equal(error.code, "TEMPVOICE_UNAVAILABLE");
    return true;
  });
});

test("B5-b — 42501 (permission) n'est PAS confondu avec une table absente", async () => {
  const fake = createFakeSupabase();
  const permissionError = { code: "42501", message: "permission denied for table temp_voice_channels" };
  fake.inject("select", permissionError);
  const repo = new SupabaseTempVoiceRepository({ supabase: fake.client });

  await assert.rejects(() => repo.findByChannel("g", "c"), (error) => {
    assert.equal(error, permissionError, "l'erreur d'origine doit remonter telle quelle");
    assert.equal(error.code, "42501");
    assert.ok(!(error instanceof TempVoiceUnavailableError));
    return true;
  });
});

test("B5-b — une erreur réseau remonte sans être avalée", async () => {
  const fake = createFakeSupabase();
  const networkError = { code: "ECONNRESET", message: "connection reset" };
  fake.inject("delete", networkError);
  const repo = new SupabaseTempVoiceRepository({ supabase: fake.client });

  await assert.rejects(() => repo.delete("g", "c"), (error) => error === networkError);
});

test("B5-b — un 23505 (double création) est idempotent, pas une erreur", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTempVoiceRepository({ supabase: fake.client });
  await repo.create(record("g", "c", "u", "lobby"));

  // Seconde création du même salon → la PK refuse, mais le dépôt ne lève pas.
  const again = await repo.create(record("g", "c", "u", "lobby"));
  assert.equal(again.channelId, "c");
  assert.equal(again.ownerId, "u");
});

test("B5-b — le dépôt exige un client Supabase", () => {
  assert.throws(() => new SupabaseTempVoiceRepository({}), /supabase client/);
  assert.throws(() => new SupabaseTempVoiceRepository({ supabase: {} }), /supabase client/);
});

// ─────────────────────────────────────────────────────────────────────────
// InMemory fallback — même sémantique que le dépôt durable
// ─────────────────────────────────────────────────────────────────────────

test("B5-b — InMemory reproduit create/find/delete avec cloisonnement par guilde", async () => {
  const repo = new InMemoryTempVoiceRepository();
  await repo.create(record("g1", "c1", "u1", "lobby1"));
  await repo.create(record("g1", "c2", "u2", "lobby1"));
  await repo.create(record("g2", "c1", "u3", "lobby2"));

  assert.deepEqual((await repo.findByGuild("g1")).map((r) => r.channelId).sort(), ["c1", "c2"]);
  assert.equal((await repo.findByChannel("g1", "c1")).ownerId, "u1");
  assert.equal(await repo.findByChannel("g2", "c2"), null);

  await repo.delete("g1", "c1");
  assert.equal(await repo.findByChannel("g1", "c1"), null);
  assert.ok(await repo.findByChannel("g2", "c1"), "le salon de g2 est intact");
});

// ─────────────────────────────────────────────────────────────────────────
// service — persistance branchée, best-effort, sans régression
// ─────────────────────────────────────────────────────────────────────────

function makeService({ repository = null, guildId = null, config = { tempvoice_enabled: true, tempvoice_lobby_channel_id: "lobby", tempvoice_category_id: "cat" }, tempChannels = new Set() } = {}) {
  let created = null;
  let moved = null;
  let deleted = null;
  const transport = {
    createChannel: async ({ name, parentId, userId }) => { created = { name, parentId, userId }; return { id: "temp1" }; },
    moveMember: async (member, channelId) => { moved = channelId; },
    isEmpty: async (id) => id === "temp1",
    deleteChannel: async (id) => { deleted = id; },
  };
  const service = new TempVoiceService({ transport, config, tempChannels, repository, guildId });
  return { service, get created() { return created; }, get moved() { return moved; }, get deleted() { return deleted; } };
}

test("B5-b — handleJoin persiste le salon dans le dépôt (guild/owner/lobby)", async () => {
  const repo = new InMemoryTempVoiceRepository();
  const { service } = makeService({ repository: repo, guildId: "g1", tempChannels: new Set() });

  const result = await service.handleJoin({ member: { id: "u1", user: { username: "bob" } }, channelId: "lobby" });

  assert.equal(result.code, "TEMPVOICE_CREATED");
  const saved = await repo.findByChannel("g1", "temp1");
  assert.ok(saved, "le salon doit être persisté");
  assert.equal(saved.ownerId, "u1");
  assert.equal(saved.lobbyId, "lobby");
});

test("B5-b — handleLeave supprime le suivi du dépôt", async () => {
  const repo = new InMemoryTempVoiceRepository();
  await repo.create(record("g1", "temp1", "u1", "lobby"));
  const { service } = makeService({ repository: repo, guildId: "g1", tempChannels: new Set(["temp1"]) });

  const result = await service.handleLeave({ channelId: "temp1" });

  assert.equal(result.code, "TEMPVOICE_DELETED");
  assert.equal(await repo.findByChannel("g1", "temp1"), null, "le suivi durable doit être supprimé");
});

test("B5-b — sans repository ni guildId, le comportement historique est conservé", async () => {
  // Même chemin que TempVoiceService.test.js : Set seul, aucune persistance.
  const { service } = makeService({ repository: null, guildId: null, tempChannels: new Set() });
  const result = await service.handleJoin({ member: { id: "u1", user: { username: "bob" } }, channelId: "lobby" });
  assert.equal(result.code, "TEMPVOICE_CREATED");
  assert.ok(service.isTempChannel("temp1"), "le Set reste la source de vérité locale");
});

test("B5-b — une panne de persistance ne casse pas la création du salon", async () => {
  const failing = {
    create: async () => { throw new Error("supabase down"); },
    delete: async () => { throw new Error("supabase down"); },
  };
  const { service } = makeService({ repository: failing, guildId: "g1", tempChannels: new Set() });

  const result = await service.handleJoin({ member: { id: "u1", user: { username: "bob" } }, channelId: "lobby" });

  assert.equal(result.code, "TEMPVOICE_CREATED", "best-effort : la persistance qui échoue ne change pas le code");
  assert.ok(service.isTempChannel("temp1"), "le salon reste fonctionnel en session");
});

// ─────────────────────────────────────────────────────────────────────────
// résolution runtime : Supabase > InMemory
// ─────────────────────────────────────────────────────────────────────────

test("B5-b — getTempVoiceRuntime utilise Supabase quand supabaseAdmin est disponible", () => {
  const databaseModule = require("../../../config/database");
  const original = databaseModule.supabaseAdmin;
  const fake = createFakeSupabase();
  Object.defineProperty(databaseModule, "supabaseAdmin", { value: fake.client, configurable: true });

  const { getTempVoiceRuntime, _resetForTests } = require("../runtime/getTempVoiceRuntime");
  _resetForTests();
  try {
    const runtime = getTempVoiceRuntime();
    assert.ok(runtime._repository instanceof SupabaseTempVoiceRepository,
      "Supabase doit être la persistance principale quand le client privilégié existe");
  } finally {
    _resetForTests();
    Object.defineProperty(databaseModule, "supabaseAdmin", { value: original, configurable: true });
  }
});

test("B5-b — repli InMemory quand supabaseAdmin est absent", () => {
  const databaseModule = require("../../../config/database");
  const original = databaseModule.supabaseAdmin;
  Object.defineProperty(databaseModule, "supabaseAdmin", { value: null, configurable: true });

  const { getTempVoiceRuntime, _resetForTests } = require("../runtime/getTempVoiceRuntime");
  _resetForTests();
  try {
    const runtime = getTempVoiceRuntime();
    assert.ok(runtime._repository instanceof InMemoryTempVoiceRepository,
      "sans client privilégié, InMemory est le repli autorisé");
  } finally {
    _resetForTests();
    Object.defineProperty(databaseModule, "supabaseAdmin", { value: original, configurable: true });
  }
});
