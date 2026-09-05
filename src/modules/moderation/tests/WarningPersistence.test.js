"use strict";

// B1 — Persistance append-only des warnings (public.warnings).
//
// Le faux client ci-dessous n'est PAS une maquette permissive : il conserve de
// vraies lignes, ÉVALUE les `.eq()` que le dépôt lui transmet et APPLIQUE les
// `.order()`. Il ne concède que INSERT et SELECT — c'est la réalité de la RLS
// de public.warnings — et LÈVE si le dépôt tente update/upsert/delete. Le
// caractère append-only est donc prouvé par construction, pas par convention.
//
// Aucun de ces tests ne parle à une vraie base : il n'y a aucune variable
// d'environnement Supabase dans cet environnement. Ce qui est prouvé ici, c'est
// la requête que le dépôt émet, pas ce que Postgres en ferait.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  InMemoryWarningRepository,
  normalizeReason,
  toDomainRow,
  REASON_MAX_LENGTH,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} = require("../persistence/WarningRepository");
const {
  SupabaseWarningRepository,
  WarningsUnavailableError,
  WARNINGS_TABLE,
} = require("../persistence/SupabaseWarningRepository");
const { WarningService } = require("../services/WarningService");
const { registerModeration } = require("../register");
const {
  InteractionRegistry,
  InteractionRouter,
  InteractionKind,
} = require("../../../core/interactions");
const { PermissionService } = require("../../../core/permissions");

/** Faux client PostgREST simulant public.warnings. */
function createFakeSupabase({ errors = {} } = {}) {
  const rows = [];
  const calls = [];
  let nextId = 1000;

  function execute(state) {
    calls.push({ ...state, filters: state.filters.map((f) => ({ ...f })), orders: [...state.orders] });
    const kind = state.mode || "select";
    if (errors[kind]) return Promise.resolve({ data: null, error: errors[kind] });

    if (state.mode === "insert") {
      // id bigint identity : PostgREST le renvoie en CHAINE, pas en nombre.
      const row = {
        id: String(nextId++),
        guild_id: state.payload.guild_id,
        user_id: state.payload.user_id,
        moderator_id: state.payload.moderator_id,
        reason: state.payload.reason === undefined ? null : state.payload.reason,
        // La base fait foi : DEFAULT now(). Le dépôt ne fournit pas created_at.
        created_at: new Date().toISOString(),
      };
      rows.push(row);
      return Promise.resolve({ data: { ...row }, error: null });
    }

    let result = rows.filter((row) => state.filters.every((f) => row[f.column] === f.value));
    for (const order of [...state.orders].reverse()) {
      result.sort((a, b) => {
        const av = Date.parse(a[order.column]);
        const bv = Date.parse(b[order.column]);
        const diff = (Number.isNaN(av) ? 0 : av) - (Number.isNaN(bv) ? 0 : bv);
        return order.ascending ? diff : -diff;
      });
    }
    if (state.limit !== null) result = result.slice(0, state.limit);
    return Promise.resolve({ data: result.map((row) => ({ ...row })), error: null });
  }

  function from(table) {
    assert.equal(table, WARNINGS_TABLE, "le dépôt doit viser public.warnings");
    const state = { table, filters: [], mode: null, payload: null, orders: [], limit: null, selected: null };
    const refuse = (verb) => () => {
      throw new Error(`public.warnings est append-only : ${verb} est interdit`);
    };
    const api = {
      select(columns) { state.selected = columns; return api; },
      eq(column, value) { state.filters.push({ type: "eq", column, value }); return api; },
      order(column, options) { state.orders.push({ column, ascending: options?.ascending !== false }); return api; },
      limit(n) { state.limit = n; return api; },
      insert(payload) { state.mode = "insert"; state.payload = payload; return api; },
      update: refuse("update"),
      upsert: refuse("upsert"),
      delete: refuse("delete"),
      async single() {
        const { data, error } = await execute(state);
        if (error) return { data: null, error };
        return { data: Array.isArray(data) ? data[0] ?? null : data, error: null };
      },
      then(resolve, reject) { return execute(state).then(resolve, reject); },
    };
    return api;
  }

  return {
    client: { from },
    rows,
    calls,
    operations: () => calls.map((c) => c.mode || "select"),
  };
}

function makeTransport({ sendWarning = null, member = undefined } = {}) {
  const calls = { getMember: 0, canModerate: 0, sendWarning: 0 };
  return {
    calls,
    async getMember(id) { calls.getMember += 1; return member === undefined ? { id, bot: false } : member; },
    canModerate() { calls.canModerate += 1; return true; },
    async sendWarning(...args) { calls.sendWarning += 1; if (sendWarning) return sendWarning(...args); },
  };
}

// ─────────────────────────────────────────────────────────────── InMemory (4)

test("InMemory : createWarning renvoie une ligne camelCase avec un id croissant", async () => {
  const repository = new InMemoryWarningRepository({ clock: () => 1_700_000_000_000 });
  const first = await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: "spam" });
  const second = await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: "flood" });

  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.deepEqual(first, {
    id: 1,
    guildId: "g1",
    userId: "u1",
    moderatorId: "m1",
    reason: "spam",
    createdAt: new Date(1_700_000_000_000).toISOString(),
  });
});

test("InMemory : raison absente = null, jamais une chaîne vide", async () => {
  const repository = new InMemoryWarningRepository();
  const withoutReason = await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1" });
  const withNull = await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: null });

  assert.equal(withoutReason.reason, null);
  assert.equal(withNull.reason, null);
  assert.equal(normalizeReason(undefined).reason, null);
  // Une chaîne vide est une raison fournie, pas une raison absente.
  assert.equal(normalizeReason("").reason, "");
});

test("InMemory : raison trop longue rejetée sans troncature ni écriture", async () => {
  const repository = new InMemoryWarningRepository();
  const tooLong = "x".repeat(REASON_MAX_LENGTH + 1);

  assert.equal(normalizeReason(tooLong).ok, false);
  assert.equal(normalizeReason(tooLong).code, "WARN_REASON_TOO_LONG");
  assert.equal(normalizeReason("x".repeat(REASON_MAX_LENGTH)).ok, true, "500 caractères passent");

  await assert.rejects(
    () => repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: tooLong }),
    /WARN_REASON_TOO_LONG/,
  );
  assert.equal(repository.store.length, 0, "aucune ligne ne doit être écrite");
});

test("InMemory : listWarnings trie created_at DESC puis id DESC, filtre et borne", async () => {
  let now = 1_700_000_000_000;
  const repository = new InMemoryWarningRepository({ clock: () => now });
  for (let i = 0; i < 3; i += 1) {
    await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: `r${i}` });
    now += 1000;
  }
  // Deux warnings dans la même milliseconde : seul `id` les départage.
  await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: "same-1" });
  await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: "same-2" });
  await repository.createWarning({ guildId: "g2", userId: "u1", moderatorId: "m1", reason: "autre guilde" });
  await repository.createWarning({ guildId: "g1", userId: "u9", moderatorId: "m1", reason: "autre membre" });

  const listed = await repository.listWarnings("g1", "u1");
  assert.equal(listed.length, 5);
  assert.deepEqual(listed.map((row) => row.reason), ["same-2", "same-1", "r2", "r1", "r0"]);
  assert.equal(listed[0].id, 5);
  assert.equal(listed[1].id, 4);

  assert.equal((await repository.listWarnings("g1", "u1", 2)).length, 2);
  assert.equal((await repository.listWarnings("g1", "u1", MAX_LIST_LIMIT + 50)).length, 5);
  assert.deepEqual(await repository.listWarnings("g1", "absent"), []);
  assert.deepEqual(await repository.listWarnings(null, "u1"), []);

  // 0 ne doit PAS signifier « zéro ligne » : c'est le signal « limite par défaut ».
  // Il faut plus de lignes que DEFAULT_LIST_LIMIT pour que l'assertion prouve
  // quelque chose, sinon les deux lectures renvoient la même chose.
  const busy = new InMemoryWarningRepository({ clock: () => 1_700_000_000_000 });
  for (let i = 0; i < DEFAULT_LIST_LIMIT + 10; i += 1) {
    await busy.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: `r${i}` });
  }
  assert.equal((await busy.listWarnings("g1", "u1", 0)).length, DEFAULT_LIST_LIMIT);
  assert.equal((await busy.listWarnings("g1", "u1")).length, DEFAULT_LIST_LIMIT);
  assert.equal((await busy.listWarnings("g1", "u1", MAX_LIST_LIMIT)).length, DEFAULT_LIST_LIMIT + 10);
});

// ─────────────────────────────────────────────────────────────── Supabase (6)

test("Supabase : createWarning insère 4 colonnes, sans created_at, sur la table warnings", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseWarningRepository({ supabase: fake.client });

  const created = await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: "spam" });

  assert.deepEqual(Object.keys(fake.calls[0].payload).sort(), ["guild_id", "moderator_id", "reason", "user_id"]);
  assert.equal("created_at" in fake.calls[0].payload, false, "la base fait foi via DEFAULT now()");
  assert.equal(fake.calls[0].table, "warnings");
  assert.deepEqual(fake.calls[0].filters, []);
  // PostgREST renvoie bigint en chaîne ; le dépôt doit le convertir.
  assert.equal(typeof created.id, "number");
  assert.equal(created.guildId, "g1");
  assert.equal(created.moderatorId, "m1");
});

test("Supabase : raison absente envoyée en null, raison trop longue jamais tronquée", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseWarningRepository({ supabase: fake.client });

  await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1" });
  assert.equal(fake.calls[0].payload.reason, null);

  await assert.rejects(
    () => repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: "x".repeat(REASON_MAX_LENGTH + 1) }),
    /WARN_REASON_TOO_LONG/,
  );
  assert.equal(fake.rows.length, 1, "le rejet survient avant tout I/O");
  assert.throws(() => new SupabaseWarningRepository({}), TypeError);
});

test("Supabase : append-only — aucune opération update/upsert/delete n'est émise", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseWarningRepository({ supabase: fake.client });

  await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: "a" });
  await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1", reason: "b" });
  await repository.listWarnings("g1", "u1");

  const operations = fake.operations();
  assert.deepEqual(operations, ["insert", "insert", "select"]);
  assert.equal(operations.includes("update"), false);
  assert.equal(operations.includes("upsert"), false);
  assert.equal(operations.includes("delete"), false);
  // Le contrat du dépôt n'expose aucune méthode de modification.
  assert.equal(typeof repository.updateWarning, "undefined");
  assert.equal(typeof repository.deleteWarning, "undefined");
});

test("Supabase : 42P01 sur INSERT devient WarningsUnavailableError", async () => {
  const cause = { code: "42P01", message: 'relation "public.warnings" does not exist' };
  const repository = new SupabaseWarningRepository({ supabase: createFakeSupabase({ errors: { insert: cause } }).client });

  let thrown;
  await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1" }).catch((e) => { thrown = e; });

  assert.ok(thrown instanceof WarningsUnavailableError);
  assert.equal(thrown.code, "WARNINGS_UNAVAILABLE");
  assert.equal(thrown.cause, cause, "l'erreur PostgREST brute doit être conservée");
});

test("Supabase : 42P01 sur SELECT devient WarningsUnavailableError", async () => {
  const cause = { code: "42P01", message: 'relation "public.warnings" does not exist' };
  const repository = new SupabaseWarningRepository({ supabase: createFakeSupabase({ errors: { select: cause } }).client });

  let thrown;
  await repository.listWarnings("g1", "u1").catch((e) => { thrown = e; });

  assert.ok(thrown instanceof WarningsUnavailableError);
  assert.equal(thrown.code, "WARNINGS_UNAVAILABLE");
});

test("Supabase : une erreur autre que 42P01 est relancée telle quelle", async () => {
  const permissionDenied = { code: "42501", message: "permission denied for table warnings" };
  const fake = createFakeSupabase({ errors: { insert: permissionDenied } });
  const repository = new SupabaseWarningRepository({ supabase: fake.client });

  let thrown;
  await repository.createWarning({ guildId: "g1", userId: "u1", moderatorId: "m1" }).catch((e) => { thrown = e; });

  assert.equal(thrown, permissionDenied, "une erreur de permission n'est pas une table absente");
  assert.equal(thrown instanceof WarningsUnavailableError, false);
});

test("Supabase : listWarnings filtre, ordonne et borne la limite à 200", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseWarningRepository({ supabase: fake.client });

  await repository.listWarnings("g1", "u1");
  const call = fake.calls[0];
  assert.deepEqual(call.filters, [
    { type: "eq", column: "guild_id", value: "g1" },
    { type: "eq", column: "user_id", value: "u1" },
  ]);
  assert.deepEqual(call.orders, [
    { column: "created_at", ascending: false },
    { column: "id", ascending: false },
  ]);
  assert.equal(call.limit, DEFAULT_LIST_LIMIT);

  await repository.listWarnings("g1", "u1", 9999);
  assert.equal(fake.calls[1].limit, MAX_LIST_LIMIT, "la limite doit être bornée");

  assert.deepEqual(await repository.listWarnings(null, "u1"), []);
  assert.deepEqual(await repository.listWarnings("g1", null), []);
  assert.equal(fake.calls.length, 2, "les arguments vides ne doivent pas atteindre la base");
});

// ──────────────────────────────────────────────── résolution du dépôt (2)

test("Chaîne de résolution : Supabase prioritaire, InMemory en repli, aucun Mongo", async () => {
  const runtime = require("../runtime/getWarningRepository");
  const { SupabaseWarningRepository: Supabase } = require("../persistence/SupabaseWarningRepository");

  runtime._resetForTests();
  const databasePath = require.resolve("../../../config/database");
  const original = require.cache[databasePath];
  try {
    // Supabase indisponible (supabaseAdmin null) → repli InMemory.
    require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { supabaseAdmin: null } };
    runtime._resetForTests();
    const fallback = runtime.getWarningRepository();
    assert.ok(fallback instanceof InMemoryWarningRepository);
    assert.equal(fallback instanceof Supabase, false);
    assert.equal(runtime.getWarningRepository(), fallback, "le dépôt doit être mémoïsé");

    // Client privilégié présent → Supabase, et rien d'autre.
    const fake = createFakeSupabase();
    require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { supabaseAdmin: fake.client } };
    runtime._resetForTests();
    const durable = runtime.getWarningRepository();
    assert.ok(durable instanceof Supabase);
    assert.equal(runtime.getWarningRepository(), durable);
  } finally {
    if (original) require.cache[databasePath] = original;
    else delete require.cache[databasePath];
    runtime._resetForTests();
  }
});

test("Chaîne de résolution : aucune référence Mongoose dans le module warning", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  // Les commentaires expliquent justement POURQUOI il n'y a pas de repli Mongo :
  // ils citent donc UserXP et InviteStats. Seuls les require() font foi.
  const requiresOf = (source) => [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  for (const file of [
    "runtime/getWarningRepository.js",
    "persistence/WarningRepository.js",
    "persistence/SupabaseWarningRepository.js",
    "services/WarningService.js",
  ]) {
    const dependencies = requiresOf(readFileSync(join(__dirname, "..", file), "utf8"));
    assert.deepEqual(
      dependencies.filter((dep) => /mongoose|models\//i.test(dep)),
      [],
      `${file} ne doit charger aucun modèle Mongo : ${dependencies.join(", ")}`,
    );
  }
});

// ───────────────────────────────────────────────────── WarningService (5)

test("Service : INSERT avant DM, puis WARN_SUCCESS", async () => {
  const order = [];
  const repository = new InMemoryWarningRepository();
  const createWarning = repository.createWarning.bind(repository);
  repository.createWarning = async (payload) => { order.push("insert"); return createWarning(payload); };

  const transport = makeTransport({ sendWarning: async () => { order.push("dm"); } });
  const service = new WarningService({ repository });

  const result = await service.warn({ guildId: "g1", actor: { id: "m1" }, targetId: "u1", reason: "spam", transport, t: (k) => k });

  assert.deepEqual(order, ["insert", "dm"], "l'écriture doit précéder le DM");
  assert.deepEqual(result, {
    warned: true,
    code: "WARN_SUCCESS",
    targetId: "u1",
    reason: "spam",
    warningId: 1,
    dmSent: true,
  });
  assert.equal(transport.calls.sendWarning, 1);
});

test("Service : échec du DM — le warning survit (§17)", async () => {
  const logger = { events: [], warn(message, details) { this.events.push({ message, details }); } };
  const repository = new InMemoryWarningRepository();
  const transport = makeTransport({ sendWarning: async () => { throw new Error("Cannot send messages to this user"); } });
  const service = new WarningService({ repository, logger });

  const result = await service.warn({ guildId: "g1", actor: { id: "m1" }, targetId: "u1", reason: "spam", transport, t: (k) => k });

  assert.equal(result.warned, true, "le warning n'est jamais annulé par un DM fermé");
  assert.equal(result.code, "WARN_SUCCESS_DM_FAILED");
  assert.equal(result.dmSent, false);
  assert.equal(result.warningId, 1);
  const stored = await repository.listWarnings("g1", "u1");
  assert.equal(stored.length, 1, "la ligne doit exister en base");
  assert.equal(stored[0].reason, "spam");
  assert.equal(logger.events.length, 1);
  assert.equal(logger.events[0].details.warningId, 1);
});

test("Service : self-warn interdit, sans écriture ni DM", async () => {
  const repository = new InMemoryWarningRepository();
  const transport = makeTransport();
  const service = new WarningService({ repository });

  const result = await service.warn({ guildId: "g1", actor: { id: "m1" }, targetId: "m1", reason: "moi-même", transport, t: (k) => k });

  assert.deepEqual(result, { warned: false, code: "WARN_SELF_TARGET" });
  assert.equal(repository.store.length, 0);
  assert.equal(transport.calls.sendWarning, 0);
  assert.equal(transport.calls.canModerate, 0, "le contrôle doit précéder canModerate");
});

test("Service : raison trop longue et cible invalide rejetées avant toute écriture", async () => {
  const repository = new InMemoryWarningRepository();
  const transport = makeTransport();
  const service = new WarningService({ repository });

  const tooLong = await service.warn({
    guildId: "g1", actor: { id: "m1" }, targetId: "u1", reason: "x".repeat(REASON_MAX_LENGTH + 1), transport, t: (k) => k,
  });
  assert.deepEqual(tooLong, { warned: false, code: "WARN_REASON_TOO_LONG" });

  const noTarget = await service.warn({ guildId: "g1", actor: { id: "m1" }, transport, t: (k) => k });
  assert.deepEqual(noTarget, { warned: false, code: "WARN_INVALID_TARGET" });

  const noGuild = await service.warn({ actor: { id: "m1" }, targetId: "u1", transport, t: (k) => k });
  assert.deepEqual(noGuild, { warned: false, code: "WARN_GUILD_MISMATCH" });

  const bot = await service.warn({ guildId: "g1", actor: { id: "m1" }, targetId: "u1", transport: makeTransport({ member: { id: "u1", bot: true } }), t: (k) => k });
  assert.equal(bot.code, "WARN_INVALID_TARGET");

  assert.equal(repository.store.length, 0);
  assert.equal(transport.calls.sendWarning, 0);
});

test("Service : échec de persistance — aucun DM, aucun succès annoncé", async () => {
  const logger = { events: [], warn(message, details) { this.events.push({ message, details }); } };
  const transport = makeTransport();
  const service = new WarningService({ repository: { createWarning: async () => { throw new WarningsUnavailableError({ code: "42P01" }); } }, logger });

  const result = await service.warn({ guildId: "g1", actor: { id: "m1" }, targetId: "u1", reason: "spam", transport, t: (k) => k });

  assert.deepEqual(result, { warned: false, code: "WARN_PERSISTENCE_FAILED" });
  assert.equal(transport.calls.sendWarning, 0, "ne jamais annoncer un warning non enregistré");
  assert.equal(logger.events.length, 1);
  assert.equal(logger.events[0].details.code, "WARNINGS_UNAVAILABLE");
});

// ─────────────────────────────────────────────────────── câblage (1)

test("Câblage : /warn journalise action, targetId, reason et moderatorId", async () => {
  const logged = [];
  const repository = new InMemoryWarningRepository();
  const transport = makeTransport();
  const registry = new InteractionRegistry();

  registerModeration({
    registry,
    transportFactory: () => transport,
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (payload) => { logged.push(payload); } }),
    warningRepositoryFactory: () => repository,
  });

  const router = new InteractionRouter({
    registry,
    contextFactory: {
      create: async (envelope) => ({
        guildId: "g1",
        userId: "m1",
        member: { has: () => true },
        permissions: new PermissionService(),
        t: (key) => key,
        envelope,
        respondError: async () => envelope.transport.replyError(),
      }),
    },
  });

  let content;
  await router.handle({
    kind: InteractionKind.COMMAND,
    name: "warn",
    discordMember: { id: "m1", guild: { name: "Guilde" }, user: { tag: "mod" } },
    options: { getUser: () => ({ id: "u1" }), getString: (n) => (n === "reason" ? "spam" : null) },
    transport: { reply: async (p) => { content = p.view.content; }, replyError: async () => {} },
  });

  assert.equal(logged.length, 1, "le log doit être émis");
  assert.equal(logged[0].action, "warn");
  assert.equal(logged[0].targetId, "u1");
  assert.equal(logged[0].reason, "spam");
  assert.equal(logged[0].moderatorId, "m1");
  assert.equal(logged[0].guild.name, "Guilde");
  assert.equal(content, "moderation.WARN_SUCCESS");
  assert.equal((await repository.listWarnings("g1", "u1")).length, 1);
  assert.equal(toDomainRow(null), null);
});
