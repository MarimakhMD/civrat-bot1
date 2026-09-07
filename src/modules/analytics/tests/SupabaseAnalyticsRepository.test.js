"use strict";

// P10 — dépôt Analytics Supabase : comptages exacts et pagination bornée.
//
// Le client Supabase est simulé au niveau de la chaîne PostgREST (select /
// eq / range / limit / order / insert) pour reproduire la sémantique réelle :
//  • select(..., { count: "exact", head: true }) => { count, data: null }
//    (en production le total vient de l'en-tête Content-Range, HEAD, 0 ligne) ;
//  • range(from, to) => tranche inclusive ;
//  • aucune limite implicite de type db-max-rows n'est appliquée ici : c'est
//    justement ce que le correctif contourne.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SupabaseAnalyticsRepository,
  ANALYTICS_COUNT_PAGE_SIZE,
  ANALYTICS_DISTINCT_SCAN_CAP,
} = require("../persistence/SupabaseAnalyticsRepository");

function makeFake({ rows = [], syntheticMemberRows = 0 } = {}) {
  const requests = [];
  const state = { rows: rows.slice() };
  // Générées une seule fois : les recréer à chaque page coûterait
  // (plafond / taille de page) × syntheticMemberRows allocations.
  const synthetic = [];
  for (let i = 0; i < syntheticMemberRows; i += 1) {
    synthetic.push({ event_type: "member", user_id: `synth-${i}`, guild_id: "g" });
  }

  function applyFilters(list, filters) {
    return list.filter((row) => filters.every(([column, value]) => row[column] === value));
  }

  function builder(table, initial = {}) {
    const ctx = { table, filters: [], options: {}, range: null, limitValue: null, ...initial };
    const api = {
      select(columns, options = {}) {
        ctx.columns = columns;
        ctx.options = { ...ctx.options, ...options };
        return api;
      },
      eq(column, value) { ctx.filters.push([column, value]); return api; },
      order() { return api; },
      limit(n) { ctx.limitValue = n; return api; },
      range(from, to) { ctx.range = [from, to]; return api; },
      insert(record) {
        ctx.inserted = record;
        // insert() ne passe pas par then() : la requête est journalisée ici.
        requests.push({ table, columns: ctx.columns, options: ctx.options, filters: ctx.filters.slice(), range: null, limitValue: null, inserted: record });
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve, reject) {
        requests.push({
          table,
          columns: ctx.columns,
          options: ctx.options,
          filters: ctx.filters.slice(),
          range: ctx.range,
          limitValue: ctx.limitValue,
          inserted: ctx.inserted,
        });
        try { resolve(run(ctx)); } catch (error) { reject(error); }
      },
    };
    return api;
  }

  function run(ctx) {
    if (ctx.inserted !== undefined) return { data: null, error: null };

    let list = applyFilters(state.rows, ctx.filters);
    const wantsMembers = ctx.filters.some(([c, v]) => c === "event_type" && v === "member");
    if (synthetic.length > 0 && wantsMembers) list = list.concat(applyFilters(synthetic, ctx.filters));

    // count=exact + head : le total exact, AUCUNE ligne transférée.
    if (ctx.options.count === "exact" && ctx.options.head === true) {
      return { data: null, error: null, count: list.length };
    }

    let slice = list;
    if (ctx.range) slice = slice.slice(ctx.range[0], ctx.range[1] + 1);
    else if (ctx.limitValue !== null) slice = slice.slice(0, ctx.limitValue);
    return { data: slice, error: null };
  }

  return { supabase: { from: (table) => builder(table) }, requests, state };
}

function seed({ messages = 0, members = 0, guildId = "g" } = {}) {
  const rows = [];
  for (let i = 0; i < messages; i += 1) rows.push({ event_type: "message", user_id: `u${i % 7}`, guild_id: guildId });
  for (let i = 0; i < members; i += 1) rows.push({ event_type: "member", user_id: `m${i % 3}`, guild_id: guildId });
  return rows;
}

// T1/T2/T3 — compteurs exacts via HEAD + count=exact, aucune ligne transférée.
test("P10/T1-T3 — getStats uses HEAD count=exact and returns exact totals with no rows", async () => {
  const fake = makeFake({ rows: seed({ messages: 1200, members: 9 }) });
  const repo = new SupabaseAnalyticsRepository({ supabase: fake.supabase });
  const stats = await repo.getStats("g");

  assert.equal(stats.messages, 1200, "au-delà de db-max-rows : le total doit rester exact");
  assert.equal(stats.total, 1209);
  assert.equal(stats.members, 3, "m0/m1/m2 dédupliqués");
  assert.equal(stats.membersTruncated, false);

  const heads = fake.requests.filter((r) => r.options.head === true && r.options.count === "exact");
  assert.equal(heads.length, 2, "2 compteurs exacts (messages + total)");
  assert.ok(heads.every((r) => r.columns === "*"), "count=exact ne demande aucune colonne précise");
});

// T4 — pagination + déduplication exacte du comptage distinct.
test("P10/T4 — distinct member count paginates and deduplicates exactly", async () => {
  const rows = [];
  for (let i = 0; i < 2500; i += 1) rows.push({ event_type: "member", user_id: `u${i % 42}`, guild_id: "g" });
  const fake = makeFake({ rows });
  const repo = new SupabaseAnalyticsRepository({ supabase: fake.supabase });
  const stats = await repo.getStats("g");

  assert.equal(stats.members, 42, "42 utilisateurs distincts sur 2500 événements");
  assert.equal(stats.membersTruncated, false);
  const paged = fake.requests.filter((r) => r.range !== null);
  assert.ok(paged.length >= 3, `2500 lignes => au moins 3 pages de ${ANALYTICS_COUNT_PAGE_SIZE}, obtenu ${paged.length}`);
  assert.equal(paged[0].range[0], 0);
  assert.equal(paged[0].range[1], ANALYTICS_COUNT_PAGE_SIZE - 1, "range inclusive");
  assert.equal(paged[0].columns, "user_id", "une seule colonne transférée");
});

// T5/T6 — plafond de sécurité : plancher + drapeau, jamais un faux exact.
test("P10/T5 — hitting the scan cap yields a floor and membersTruncated true", async () => {
  const fake = makeFake({ rows: seed({ messages: 1 }), syntheticMemberRows: ANALYTICS_DISTINCT_SCAN_CAP + 5000 });
  const repo = new SupabaseAnalyticsRepository({ supabase: fake.supabase });
  const stats = await repo.getStats("g");

  assert.equal(stats.membersTruncated, true, "le plafond doit lever le drapeau");
  assert.ok(stats.members > 0, "un plancher reste affiché, pas 0");
  const paged = fake.requests.filter((r) => r.range !== null);
  assert.equal(paged.length, ANALYTICS_DISTINCT_SCAN_CAP / ANALYTICS_COUNT_PAGE_SIZE, "le scan s'arrête au plafond");
});

test("P10/T6 — below the cap the flag stays false", async () => {
  const fake = makeFake({ rows: seed({ messages: 5, members: 60 }) });
  const repo = new SupabaseAnalyticsRepository({ supabase: fake.supabase });
  assert.equal((await repo.getStats("g")).membersTruncated, false);
});

// T7/T8 — agrégats globaux : messages exact, distincts paginés, aucun filtre guild.
test("P10/T7-T8 — getGlobalStats: exact messages, paginated distincts, no guild filter", async () => {
  const rows = [
    ...seed({ messages: 1500, members: 6, guildId: "g1" }),
    ...seed({ messages: 700, members: 6, guildId: "g2" }),
  ];
  const fake = makeFake({ rows });
  const repo = new SupabaseAnalyticsRepository({ supabase: fake.supabase });
  const stats = await repo.getGlobalStats();

  assert.equal(stats.messages, 2200, "somme globale exacte");
  assert.equal(stats.servers, 2, "g1 et g2");
  assert.equal(stats.members, 3, "m0/m1/m2 partagés entre guildes");
  assert.equal(stats.truncated, false);

  const messageCount = fake.requests.find((r) => r.options.head === true);
  assert.ok(messageCount, "un compteur exact est utilisé");
  assert.ok(
    fake.requests.filter((r) => r.options.head === true).every((r) => !r.filters.some(([c]) => c === "guild_id")),
    "getGlobalStats ne filtre aucune guilde"
  );
});

// T9 — fail-loud : une erreur PostgREST est propagée, jamais un 0 silencieux.
// Note : comme SupabaseTicketCounterRepository, le dépôt re-lance l'objet
// PostgREST BRUT (pas une instance d'Error). Le test asserte donc l'identité
// de l'objet plutôt qu'un motif sur le message.
test("P10/T9 — PostgREST errors are propagated, never swallowed into zeros", async () => {
  const postgrestError = { message: "permission denied", code: "42501" };
  // Chaînable sur plusieurs .eq() et thenable : comme le vrai builder.
  const failing = {
    from: () => {
      const api = {
        select: () => api,
        eq: () => api,
        range: () => api,
        limit: () => api,
        order: () => api,
        then: (resolve) => resolve({ data: null, count: null, error: postgrestError }),
      };
      return api;
    },
  };
  const repo = new SupabaseAnalyticsRepository({ supabase: failing });
  let thrown = "aucune exception";
  try { await repo.getStats("g"); } catch (error) { thrown = error; }
  assert.notEqual(thrown, "aucune exception", "l'erreur doit être propagée, pas avalée");
  assert.equal(thrown, postgrestError, "l'objet PostgREST est re-lancé tel quel");

  let globalThrown = "aucune exception";
  try { await repo.getGlobalStats(); } catch (error) { globalThrown = error; }
  assert.equal(globalThrown, postgrestError, "getGlobalStats propage aussi");
});

// T11 — getEvents strictement inchangé (non-régression).
test("P10/T11 — getEvents behaviour is unchanged", async () => {
  const rows = seed({ messages: 5, members: 2 });
  const fake = makeFake({ rows });
  const repo = new SupabaseAnalyticsRepository({ supabase: fake.supabase });
  const events = await repo.getEvents("g", "message", 3);
  assert.equal(events.length, 3);
  const request = fake.requests[0];
  assert.equal(request.columns, "*");
  assert.equal(request.limitValue, 3, "limite appliquée");
  assert.equal(request.range, null, "getEvents utilise limit, pas range");
});

// getServerStats reste un alias exact de getStats.
test("P10 — getServerStats is an exact alias of getStats", async () => {
  const fake = makeFake({ rows: seed({ messages: 4, members: 3 }) });
  const repo = new SupabaseAnalyticsRepository({ supabase: fake.supabase });
  assert.deepEqual(await repo.getServerStats("g"), await repo.getStats("g"));
});

// track reste strictement inchangé : 4 colonnes, aucune de plus.
test("P10 — track still writes exactly the 4 columns", async () => {
  const fake = makeFake();
  const repo = new SupabaseAnalyticsRepository({ supabase: fake.supabase });
  await repo.track("g", { type: "message", userId: "u1" });
  const written = fake.requests.find((r) => r.inserted);
  assert.deepEqual(Object.keys(written.inserted).sort(), ["created_at", "event_type", "guild_id", "user_id"]);
});

// Garde-fou constructeur inchangé.
test("P10 — constructor still rejects a missing supabase client", () => {
  assert.throws(() => new SupabaseAnalyticsRepository({}), TypeError);
});
