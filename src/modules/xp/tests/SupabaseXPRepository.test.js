"use strict";

// B3 — Dépôt XP sur public.member_xp.
//
// Le faux client ci-dessous n'est PAS une maquette permissive : il conserve de
// vraies lignes et ÉVALUE les prédicats que le dépôt lui transmet. Si le dépôt
// envoie une mauvaise condition, le faux renvoie 0 ligne et le test échoue.
// C'est ce qui permet de prouver le compare-and-swap : deux appels concurrents
// passent réellement par deux lectures puis deux écritures conditionnées.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SupabaseXPRepository,
  MemberXpUnavailableError,
  MEMBER_XP_TABLE,
  MAX_CAS_ATTEMPTS,
} = require("../persistence/SupabaseXPRepository");
const { InMemoryXPRepository } = require("../persistence/XPRepository");
const { LevelService } = require("../services/LevelService");

const levelFor = (xp) => new LevelService().levelForXp(xp);

/** Décompose une expression `.or()` PostgREST en conditions évaluables. */
function parseOrExpression(expression) {
  return expression.split(",").map((part) => {
    const first = part.indexOf(".");
    const column = part.slice(0, first);
    const rest = part.slice(first + 1);
    const second = rest.indexOf(".");
    const op = rest.slice(0, second);
    const value = rest.slice(second + 1);
    return { column, op, value };
  });
}

function rowMatches(row, filters) {
  return filters.every((filter) => {
    if (filter.type === "eq") return row[filter.column] === filter.value;
    if (filter.type === "or") {
      return filter.conditions.some((condition) => {
        const stored = row[condition.column];
        if (condition.op === "is" && condition.value === "null") {
          return stored === null || stored === undefined;
        }
        if (condition.op === "lt") {
          return stored !== null && stored !== undefined && stored < condition.value;
        }
        if (condition.op === "lte") {
          return stored !== null && stored !== undefined && stored <= condition.value;
        }
        throw new Error(`condition .or() non prise en charge : ${condition.op}`);
      });
    }
    throw new Error(`filtre non pris en charge : ${filter.type}`);
  });
}

/**
 * Faux client Supabase simulant public.member_xp.
 *
 * @param {object} [options]
 * @param {object} [options.errors] erreurs à injecter, par opération
 *   (`select` / `insert` / `update`), sous la forme `{ code, message }`.
 */
function createFakeSupabase({ errors = {}, updateNeverMatches = false, beforeUpdate = null } = {}) {
  const rows = new Map(); // "guild:user" -> ligne snake_case
  const calls = [];
  let injected = { ...errors };

  const keyOf = (guildId, userId) => `${guildId}:${userId}`;

  function execute(state) {
    calls.push({ ...state, filters: state.filters.map((f) => ({ ...f })) });

    if (injected[state.mode || "select"]) {
      const error = injected[state.mode || "select"];
      if (error === "once") delete injected[state.mode || "select"];
      return Promise.resolve({ data: null, error: injected[state.mode || "select"] || error });
    }

    if (state.mode === "insert") {
      const key = keyOf(state.payload.guild_id, state.payload.user_id);
      if (rows.has(key)) {
        return Promise.resolve({
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        });
      }
      const row = {
        guild_id: state.payload.guild_id,
        user_id: state.payload.user_id,
        xp: state.payload.xp,
        level: state.payload.level,
        last_xp_at: state.payload.last_xp_at ?? null,
        created_at: state.payload.created_at ?? new Date().toISOString(),
        updated_at: state.payload.updated_at ?? new Date().toISOString(),
      };
      rows.set(key, row);
      return Promise.resolve({ data: { ...row }, error: null });
    }

    if (state.mode === "update") {
      const matched = [];
      // Point d'injection placé APRÈS la lecture du dépôt et AVANT l'application
      // de l'UPDATE : c'est la fenêtre réelle où un autre processus peut écrire.
      if (typeof beforeUpdate === "function") beforeUpdate(rows, state);
      if (!updateNeverMatches) {
        for (const row of rows.values()) {
          if (rowMatches(row, state.filters)) {
            Object.assign(row, state.payload);
            matched.push({ ...row });
          }
        }
      }
      return Promise.resolve({ data: matched, error: null });
    }

    if (state.mode === "upsert") {
      const key = keyOf(state.payload.guild_id, state.payload.user_id);
      const row = { ...(rows.get(key) || {}), ...state.payload };
      rows.set(key, row);
      return Promise.resolve({ data: [{ ...row }], error: null });
    }

    // Lecture
    let result = [...rows.values()].filter((row) => rowMatches(row, state.filters));
    for (const order of [...state.orders].reverse()) {
      result.sort((a, b) => {
        const diff = (a[order.column] || 0) - (b[order.column] || 0);
        return order.ascending ? diff : -diff;
      });
    }
    if (state.limit !== null) result = result.slice(0, state.limit);
    return Promise.resolve({ data: result.map((row) => ({ ...row })), error: null });
  }

  function from(table) {
    assert.equal(table, MEMBER_XP_TABLE, "le dépôt doit viser public.member_xp");
    const state = { table, filters: [], mode: null, payload: null, orders: [], limit: null };
    const api = {
      select() { return api; },
      eq(column, value) { state.filters.push({ type: "eq", column, value }); return api; },
      or(expression) { state.filters.push({ type: "or", conditions: parseOrExpression(expression) }); return api; },
      order(column, options) { state.orders.push({ column, ascending: options?.ascending !== false }); return api; },
      limit(n) { state.limit = n; return api; },
      insert(payload) { state.mode = "insert"; state.payload = payload; return api; },
      update(payload) { state.mode = "update"; state.payload = payload; return api; },
      upsert(payload, options) { state.mode = "upsert"; state.payload = payload; state.options = options; return api; },
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
    /** Programme une erreur pour les prochaines opérations d'un type donné. */
    inject(mode, error) { injected[mode] = error; },
    clearErrors() { injected = {}; },
    operations() { return calls.map((c) => c.mode || "select"); },
  };
}

function makeRepository(fake, clockValue = 1_000_000) {
  return new SupabaseXPRepository({ supabase: fake.client, clock: () => clockValue });
}

test("B3 — le dépôt exige un client Supabase", () => {
  assert.throws(() => new SupabaseXPRepository({}), /supabase client/);
  assert.throws(() => new SupabaseXPRepository({ supabase: {} }), /supabase client/);
});

test("B3 — findOne renvoie null avant toute écriture", async () => {
  const fake = createFakeSupabase();
  const repo = makeRepository(fake);
  assert.equal(await repo.findOne("g", "u"), null);
});

test("B3 — le premier gain crée la ligne member_xp", async () => {
  const fake = createFakeSupabase();
  const repo = makeRepository(fake);

  const outcome = await repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 60, computeLevel: levelFor,
  });

  assert.deepEqual(outcome, {
    applied: true, xpGain: 15, xp: 15, level: 0, previousXp: 0, previousLevel: 0,
  });
  const stored = fake.rows.get("g:u");
  assert.equal(stored.xp, 15);
  assert.equal(stored.level, 0);
  assert.equal(typeof stored.last_xp_at, "string", "last_xp_at doit être horodaté");
  assert.equal(typeof stored.updated_at, "string");
});

test("B3 — le cooldown est respecté via last_xp_at", async () => {
  const fake = createFakeSupabase();
  let now = 0;
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => now });
  const call = () => repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 60, computeLevel: levelFor, now,
  });

  assert.equal((await call()).applied, true);

  now = 30_000;
  const blocked = await call();
  assert.equal(blocked.applied, false);
  assert.equal(blocked.code, "XP_COOLDOWN");
  assert.equal(fake.rows.get("g:u").xp, 15, "aucun XP ne doit être ajouté pendant le cooldown");

  now = 60_000;
  const granted = await call();
  assert.equal(granted.applied, true);
  assert.equal(granted.xp, 30);
  assert.equal(granted.previousXp, 15);
});

test("B3 — cooldown 0 : chaque message passe et last_xp_at n'est jamais un filtre", async () => {
  const fake = createFakeSupabase();
  const now = 0;
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => now });

  for (let i = 0; i < 4; i += 1) {
    const outcome = await repo.applyGain({
      guildId: "g", userId: "u", gain: 10, cooldownSeconds: 0, computeLevel: levelFor, now,
    });
    assert.equal(outcome.applied, true);
  }
  assert.equal(fake.rows.get("g:u").xp, 40);

  const orFilters = fake.calls.filter((c) => c.filters.some((f) => f.type === "or"));
  assert.equal(orFilters.length, 0, "cooldown 0 ne doit poser aucune condition sur last_xp_at");
});

test("B3 — le niveau suit floor(xp/100) et franchit les paliers", async () => {
  const fake = createFakeSupabase();
  let now = 0;
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => now });
  const call = () => repo.applyGain({
    guildId: "g", userId: "u", gain: 50, cooldownSeconds: 0, computeLevel: levelFor, now,
  });

  assert.equal((await call()).level, 0);
  const second = await call();
  assert.equal(second.xp, 100);
  assert.equal(second.level, 1);
  assert.equal(second.previousLevel, 0, "le palier franchi doit être signalé");
  const third = await call();
  assert.equal(third.level, 1);
  assert.equal(third.previousLevel, 1, "pas de montée au troisième gain");
});

// ─────────────────────────────────────────────────────────────────────────
// CONCURRENCE — le cœur de B3
// ─────────────────────────────────────────────────────────────────────────

test("B3 — deux messages simultanés du même membre ne perdent aucun gain", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 });
  const call = () => repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 0, computeLevel: levelFor, now: 0,
  });

  const results = await Promise.all([call(), call()]);

  assert.equal(results.filter((r) => r.applied).length, 2, "les deux gains doivent être appliqués");
  assert.equal(fake.rows.get("g:u").xp, 30, "2 × 15 XP, aucune perte");
});

test("B3 — cinq messages simultanés du même membre totalisent 5 gains", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 });
  const call = () => repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 0, computeLevel: levelFor, now: 0,
  });

  await Promise.all([call(), call(), call(), call(), call()]);

  assert.equal(fake.rows.get("g:u").xp, 75, "5 × 15 = 75, aucun gain perdu");
  assert.equal(fake.rows.get("g:u").level, 0);
});

test("B3 — le conflit est résolu par relecture, jamais par écrasement", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 });
  // Ligne préexistante : les deux appels concurrents empruntent tous deux le
  // chemin UPDATE conditionné, ce qui est le cas de conflit réel.
  await repo.upsert("g", "u", 15, 0);
  fake.calls.length = 0;

  const call = () => repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 0, computeLevel: levelFor, now: 0,
  });

  const results = await Promise.all([call(), call()]);

  assert.equal(results.filter((r) => r.applied).length, 2, "les deux gains doivent aboutir");
  assert.equal(fake.rows.get("g:u").xp, 45, "15 + 15 + 15, aucune perte");

  // Au moins un UPDATE a dû ne correspondre à aucune ligne puis être rejoué :
  // c'est la preuve que le verrou optimiste a fonctionné au lieu d'écraser.
  const updates = fake.calls.filter((c) => c.mode === "update");
  assert.ok(updates.length >= 2, `au moins 2 tentatives d'UPDATE attendues, obtenu ${updates.length}`);
  assert.ok(updates.every((u) => u.filters.some((f) => f.type === "eq" && f.column === "xp")),
    "chaque UPDATE doit être conditionné sur la valeur d'xp lue");
});

test("B3 — plusieurs membres et guildes simultanés restent isolés", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 });
  const call = (guildId, userId) => repo.applyGain({
    guildId, userId, gain: 15, cooldownSeconds: 0, computeLevel: levelFor, now: 0,
  });

  await Promise.all([
    call("g1", "a"), call("g1", "b"), call("g2", "a"), call("g2", "b"),
    call("g1", "a"), call("g2", "b"),
  ]);

  assert.equal(fake.rows.get("g1:a").xp, 30);
  assert.equal(fake.rows.get("g1:b").xp, 15);
  assert.equal(fake.rows.get("g2:a").xp, 15);
  assert.equal(fake.rows.get("g2:b").xp, 30);
});

test("B3 — deux messages simultanés ne peuvent pas franchir le cooldown ensemble", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 });
  const call = () => repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 60, computeLevel: levelFor, now: 0,
  });

  const results = await Promise.all([call(), call(), call()]);

  assert.equal(fake.rows.get("g:u").xp, 15, "un seul gain ne doit franchir le cooldown");
  assert.equal(results.filter((r) => r.applied).length, 1);
  assert.equal(results.filter((r) => r.code === "XP_COOLDOWN").length, 2);
});

test("B3 — la garde SQL du cooldown est décisive si la ligne change entre lecture et écriture", async () => {
  // Le contrôle JS de première passe ne suffit pas : un autre processus peut
  // accorder de l'XP entre notre lecture et notre écriture. Seule la condition
  // posée sur l'UPDATE lui-même empêche alors un second gain.
  let stolen = false;
  const fake = createFakeSupabase({
    // Simule un autre processus qui accorde de l'XP dans la fenêtre exacte
    // entre la lecture du dépôt et l'application de son UPDATE.
    beforeUpdate: (rows) => {
      if (!stolen) {
        stolen = true;
        rows.get("g:u").last_xp_at = new Date(100_000).toISOString();
      }
    },
  });

  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 100_000 });
  await repo.upsert("g", "u", 15, 0);
  // last_xp_at ancien : le contrôle JS de première passe laisse passer.
  fake.rows.get("g:u").last_xp_at = new Date(0).toISOString();

  const outcome = await repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 60, computeLevel: levelFor, now: 100_000,
  });

  assert.equal(stolen, true, "l'injection doit bien avoir eu lieu");
  assert.equal(outcome.applied, false, "la garde SQL doit bloquer le second gain");
  assert.equal(outcome.code, "XP_COOLDOWN");
  assert.equal(fake.rows.get("g:u").xp, 15, "aucun XP ne doit être ajouté");
});

// ─────────────────────────────────────────────────────────────────────────
// CLASSEMENT
// ─────────────────────────────────────────────────────────────────────────

test("B3 — getLeaderboard trie, limite et isole par guilde", async () => {
  const fake = createFakeSupabase();
  const repo = makeRepository(fake);
  await repo.upsert("g", "low", 50, 0);
  await repo.upsert("g", "top", 300, 3);
  await repo.upsert("g", "mid", 100, 1);
  await repo.upsert("other", "alien", 9999, 9);

  const top2 = await repo.getLeaderboard("g", 2);
  assert.deepEqual(top2, [
    { userId: "top", xp: 300, level: 3 },
    { userId: "mid", xp: 100, level: 1 },
  ]);

  const full = await repo.getLeaderboard("g", 10);
  assert.equal(full.length, 3);
  assert.ok(full.every((e) => e.userId !== "alien"), "aucune fuite entre guildes");
});

test("B3 — getLeaderboard pousse le tri et la limite en base", async () => {
  const fake = createFakeSupabase();
  const repo = makeRepository(fake);
  await repo.getLeaderboard("g", 7);
  const call = fake.calls.at(-1);
  assert.deepEqual(call.orders, [
    { column: "xp", ascending: false },
    { column: "level", ascending: false },
  ]);
  assert.equal(call.limit, 7);
});

// ─────────────────────────────────────────────────────────────────────────
// ERREURS
// ─────────────────────────────────────────────────────────────────────────

test("B3 — 42P01 signale une table absente de façon distinguable", async () => {
  const fake = createFakeSupabase();
  fake.inject("select", { code: "42P01", message: "relation \"public.member_xp\" does not exist" });
  const repo = makeRepository(fake);

  await assert.rejects(() => repo.findOne("g", "u"), (error) => {
    assert.ok(error instanceof MemberXpUnavailableError);
    assert.equal(error.code, "MEMBER_XP_UNAVAILABLE");
    return true;
  });
});

test("B3 — 42501 (permission) n'est PAS confondu avec une table absente", async () => {
  const fake = createFakeSupabase();
  const permissionError = { code: "42501", message: "permission denied for table member_xp" };
  fake.inject("select", permissionError);
  const repo = makeRepository(fake);

  await assert.rejects(() => repo.findOne("g", "u"), (error) => {
    assert.equal(error, permissionError, "l'erreur d'origine doit remonter telle quelle");
    assert.equal(error.code, "42501");
    assert.ok(!(error instanceof MemberXpUnavailableError));
    return true;
  });
});

test("B3 — un refus de permission dont le texte mentionne la relation reste un 42501", async () => {
  // Cas piège visé par la convention M5 : classifier sur le TEXTE du message
  // ferait passer ce refus de permission pour une table absente. Seul le code
  // SQLState fait foi.
  const fake = createFakeSupabase();
  const tricky = {
    code: "42501",
    message: 'permission denied for relation "member_xp": it does not exist for role anon',
  };
  fake.inject("select", tricky);
  const repo = makeRepository(fake);

  await assert.rejects(() => repo.findOne("g", "u"), (error) => {
    assert.ok(!(error instanceof MemberXpUnavailableError),
      "un 42501 ne doit JAMAIS être pris pour une table absente, quel que soit son texte");
    assert.equal(error.code, "42501");
    return true;
  });
});

test("B3 — une erreur réseau remonte sans être avalée", async () => {
  const fake = createFakeSupabase();
  const networkError = { code: "ECONNRESET", message: "connection reset" };
  fake.inject("insert", networkError);
  const repo = makeRepository(fake);

  await assert.rejects(
    () => repo.applyGain({ guildId: "g", userId: "u", gain: 15, cooldownSeconds: 0, computeLevel: levelFor, now: 0 }),
    (error) => error === networkError
  );
});

test("B3 — un conflit de PK simultané est retenté, pas remonté", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 });
  // La première insertion échoue sur la PK ; la relecture suivante doit
  // basculer sur le chemin UPDATE.
  let firstInsert = true;
  const originalFrom = fake.client.from.bind(fake.client);
  fake.client.from = (table) => {
    const builder = originalFrom(table);
    const originalInsert = builder.insert.bind(builder);
    builder.insert = (payload) => {
      if (firstInsert) {
        firstInsert = false;
        fake.rows.set("g:u", {
          guild_id: "g", user_id: "u", xp: 15, level: 0,
          last_xp_at: null, created_at: "", updated_at: "",
        });
      }
      return originalInsert(payload);
    };
    return builder;
  };

  const outcome = await repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 0, computeLevel: levelFor, now: 0,
  });
  assert.equal(outcome.applied, true);
  assert.equal(fake.rows.get("g:u").xp, 30, "le gain doit être ajouté à la ligne créée par l'autre appel");
});

test("B3 — un gain nul ou invalide n'écrit pas de valeur absurde", async () => {
  const fake = createFakeSupabase();
  const repo = makeRepository(fake);
  for (const gain of [0, -5, NaN, null, "abc"]) {
    const outcome = await repo.applyGain({
      guildId: "g", userId: "u", gain, cooldownSeconds: 0, computeLevel: levelFor, now: 0,
    });
    assert.equal(outcome.xpGain, 0, `gain ${String(gain)} doit être ramené à 0`);
  }
  assert.equal(fake.rows.get("g:u").xp, 0);
});

test("B3 — un gain nul ne pose pas last_xp_at et ne bloque pas un gain réel", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 });

  const zero = await repo.applyGain({
    guildId: "g", userId: "u", gain: 0, cooldownSeconds: 60, computeLevel: levelFor, now: 0,
  });
  assert.equal(zero.applied, true);
  assert.equal(zero.xpGain, 0);
  assert.equal(fake.rows.get("g:u").last_xp_at, null,
    "un gain de 0 ne doit pas horodater : aucun XP n'a été accordé");

  // Le défaut mesuré avant correction : ce gain réel était refusé en
  // XP_COOLDOWN alors que personne n'avait jamais reçu d'XP.
  const real = await repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 60, computeLevel: levelFor, now: 1_000,
  });
  assert.equal(real.applied, true, "un gain réel ne doit pas être bloqué par un gain nul antérieur");
  assert.equal(real.xp, 15);
  assert.notEqual(fake.rows.get("g:u").last_xp_at, null, "le gain réel, lui, horodate");
});

test("B3 — un gain nul sur une ligne existante n'efface pas l'horodatage", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 });

  await repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 60, computeLevel: levelFor, now: 0,
  });
  const stamped = fake.rows.get("g:u").last_xp_at;
  assert.notEqual(stamped, null);

  await repo.applyGain({
    guildId: "g", userId: "u", gain: 0, cooldownSeconds: 60, computeLevel: levelFor, now: 5_000,
  });
  assert.equal(fake.rows.get("g:u").last_xp_at, stamped,
    "un gain nul ne doit pas effacer un horodatage existant (cela réouvrirait le cooldown)");
  assert.equal(fake.rows.get("g:u").xp, 15);
});

test("B3 — six messages simultanés du même membre ne perdent plus aucun gain", async () => {
  // Seuil mesuré de l'ancien budget : avec MAX_CAS_ATTEMPTS = 5, ce scénario
  // perdait 15 XP dans 30 essais sur 30.
  const fake = createFakeSupabase();
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 });
  const call = () => repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 0, computeLevel: levelFor, now: 0,
  });

  const results = await Promise.all([call(), call(), call(), call(), call(), call()]);

  assert.equal(results.filter((r) => r.applied).length, 6, "les six gains doivent aboutir");
  assert.equal(results.filter((r) => r.code === "XP_CONFLICT").length, 0, "aucun renoncement");
  assert.equal(fake.rows.get("g:u").xp, 90, "6 × 15 = 90, aucune perte");
});

test("B3 — upsert respecte le contrat XPRepository (écriture absolue)", async () => {
  const fake = createFakeSupabase();
  const repo = makeRepository(fake);
  const row = await repo.upsert("g", "u", 420, 4);
  assert.equal(row.xp, 420);
  assert.equal(row.level, 4);
  assert.equal(row.guildId, "g");
  assert.equal(row.userId, "u");
});

test("B3 — MAX_CAS_ATTEMPTS est borné et un conflit permanent est signalé", async () => {
  // Budget porté de 5 à 40 : mesuré, un budget de 5 perdait 15 XP dès six
  // messages simultanés du même membre ; 40 ne perd rien jusqu'à 40 écrivains.
  assert.equal(MAX_CAS_ATTEMPTS, 40);

  // Un dépôt dont l'UPDATE ne correspond jamais (conflit permanent) doit
  // renoncer proprement au lieu de boucler ou d'inventer un total.
  const fake = createFakeSupabase({ updateNeverMatches: true });
  const repo = new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 });

  await repo.upsert("g", "u", 100, 1);
  const outcome = await repo.applyGain({
    guildId: "g", userId: "u", gain: 15, cooldownSeconds: 0, computeLevel: levelFor, now: 0,
  });

  assert.equal(outcome.applied, false);
  assert.equal(outcome.code, "XP_CONFLICT");
  assert.equal(fake.rows.get("g:u").xp, 100, "aucun XP ne doit être inventé");
  assert.equal(
    fake.calls.filter((c) => c.mode === "update").length,
    MAX_CAS_ATTEMPTS,
    "le nombre de tentatives doit être exactement borné"
  );
});

// ─────────────────────────────────────────────────────────────────────────
// INTÉGRATION runtime / repli / Analytics
// ─────────────────────────────────────────────────────────────────────────

test("B3 — getXPRuntime utilise Supabase quand supabaseAdmin est disponible", () => {
  const databaseModule = require("../../../config/database");
  const original = databaseModule.supabaseAdmin;
  const fake = createFakeSupabase();
  Object.defineProperty(databaseModule, "supabaseAdmin", { value: fake.client, configurable: true });

  const { getXPRuntime, _resetForTests } = require("../runtime/getXPRuntime");
  _resetForTests();
  try {
    const runtime = getXPRuntime();
    assert.ok(runtime._repository instanceof SupabaseXPRepository,
      "Supabase doit être la persistance principale quand le client privilégié existe");
  } finally {
    _resetForTests();
    Object.defineProperty(databaseModule, "supabaseAdmin", { value: original, configurable: true });
  }
});

test("B3 — repli InMemory quand supabaseAdmin est absent", () => {
  const databaseModule = require("../../../config/database");
  const original = databaseModule.supabaseAdmin;
  Object.defineProperty(databaseModule, "supabaseAdmin", { value: null, configurable: true });

  const { getXPRuntime, _resetForTests } = require("../runtime/getXPRuntime");
  _resetForTests();
  try {
    const runtime = getXPRuntime();
    assert.ok(runtime._repository instanceof InMemoryXPRepository,
      "sans client privilégié, InMemory est le seul repli autorisé");
  } finally {
    _resetForTests();
    Object.defineProperty(databaseModule, "supabaseAdmin", { value: original, configurable: true });
  }
});

test("B3 — l'XP survit à la recréation du runtime", async () => {
  const fake = createFakeSupabase();
  const { createXPRuntime } = require("../runtime/createXPRuntime");
  const configService = { read: async () => ({ xp_enabled: true, xp_per_message: 15, xp_cooldown: 0 }) };
  const message = { guild: { id: "g" }, author: { id: "u", bot: false }, channel: { id: "c" } };

  const first = createXPRuntime({
    configService,
    repository: new SupabaseXPRepository({ supabase: fake.client, clock: () => 0 }),
  });
  await first.handleMessage(message);
  await first.handleMessage(message);

  // Nouveau runtime, MÊME base : c'est ce qui distingue une persistance réelle
  // d'un store en mémoire.
  const second = createXPRuntime({
    configService,
    repository: new SupabaseXPRepository({ supabase: fake.client, clock: () => 1_000 }),
  });
  const result = await second.handleMessage(message);

  assert.equal(result.xp, 45, "les 30 XP antérieurs doivent avoir survécu");
  assert.equal(result.previousLevel, 0);
});

test("B3 — Analytics lit le même dépôt que le chemin d'écriture", async () => {
  const databaseModule = require("../../../config/database");
  const original = databaseModule.supabaseAdmin;
  const fake = createFakeSupabase();
  Object.defineProperty(databaseModule, "supabaseAdmin", { value: fake.client, configurable: true });

  const xpModule = require("../runtime/getXPRuntime");
  const analyticsModule = require("../../analytics/runtime/getAnalyticsRuntime");
  const guildConfigModule = require("../../../services/guildConfig");
  const originalGet = guildConfigModule.getGuildConfig;
  guildConfigModule.getGuildConfig = async () => ({ analytics_enabled: true, xp_enabled: true, xp_per_message: 20, xp_cooldown: 0 });

  xpModule._resetForTests();
  analyticsModule._resetForTests();
  try {
    const xpRuntime = xpModule.getXPRuntime();
    assert.ok(xpRuntime._repository instanceof SupabaseXPRepository);

    await xpRuntime.handleMessage({ guild: { id: "g" }, author: { id: "grinder", bot: false }, channel: { id: "c" } });
    await xpRuntime.handleMessage({ guild: { id: "g" }, author: { id: "grinder", bot: false }, channel: { id: "c" } });

    const analyticsRuntime = analyticsModule.getAnalyticsRuntime();
    assert.equal(analyticsRuntime._service.xpRepository, xpRuntime._repository,
      "Analytics doit viser EXACTEMENT le dépôt écrit par messageCreate");

    const top = await analyticsRuntime.getTopXP("g", 5);
    assert.equal(top[0].userId, "grinder");
    assert.equal(top[0].xp, 40, "les deux gains doivent être visibles dans le classement");
  } finally {
    guildConfigModule.getGuildConfig = originalGet;
    xpModule._resetForTests();
    analyticsModule._resetForTests();
    Object.defineProperty(databaseModule, "supabaseAdmin", { value: original, configurable: true });
  }
});
