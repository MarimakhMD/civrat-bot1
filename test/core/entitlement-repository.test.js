"use strict";

// ───────────────────────────────────────────────────────────────
// G2-B — SupabaseEntitlementRepository : findFeature / setStatus / activate.
//
// Verrouille les requêtes Supabase réellement émises (faux client, jamais une
// vraie base) pour une guilde ORDINAIRE (non-technique) :
//   • findFeature → .select("*").eq(guild_id).eq(feature_key).maybeSingle() ;
//   • cas 0 ligne → null (maybeSingle ne lève pas) ;
//   • propagation des erreurs PostgREST ;
//   • setStatus sur guilde ordinaire → .update({status}).eq.eq sans permit ;
//   • activate sur guilde ordinaire → .upsert(onConflict: guild_id,feature_key).
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const { SupabaseEntitlementRepository } = require("../../src/adapters/supabase/SupabaseEntitlementRepository");
const { EntitlementFeature } = require("../../src/core/entitlements");

const GUILD_ID = "111111111111111111";

/** Faux client PostgREST : journalise la chaîne et rejoue `results`. */
function makeClient(results = []) {
  const calls = [];
  let resultIndex = 0;
  function builder(table) {
    const state = { table, columns: null, op: null, payload: null, onConflict: null, filters: [], terminal: null };
    const api = {
      select(columns) { state.columns = columns ?? "*"; return api; },
      insert(payload) { state.op = "insert"; state.payload = payload; return api; },
      update(payload) { state.op = "update"; state.payload = payload; return api; },
      upsert(payload, options) { state.op = "upsert"; state.payload = payload; state.onConflict = options?.onConflict ?? null; return api; },
      eq(column, value) { state.filters.push([column, value]); return api; },
      maybeSingle() { state.terminal = "maybeSingle"; return api; },
      then(resolve, reject) {
        calls.push({
          table: state.table, columns: state.columns, op: state.op, payload: state.payload,
          onConflict: state.onConflict, filters: state.filters.map((f) => [...f]), terminal: state.terminal,
        });
        const result = results[resultIndex] || { data: null, error: null };
        resultIndex += 1;
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return api;
  }
  return { client: { from: builder }, calls };
}

// ───────────────────────────────────────────────────────────────
// findFeature
// ───────────────────────────────────────────────────────────────

test("G2-B: findFeature émet select(*).eq(guild_id).eq(feature_key).maybeSingle()", async () => {
  const { client, calls } = makeClient([{ data: null, error: null }]);
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  await repo.findFeature(GUILD_ID, EntitlementFeature.WELCOME_IMAGE);

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.table, "guild_entitlements");
  assert.equal(call.columns, "*");
  assert.deepEqual(call.filters, [
    ["guild_id", GUILD_ID],
    ["feature_key", EntitlementFeature.WELCOME_IMAGE],
  ]);
  assert.equal(call.terminal, "maybeSingle", "une seule ligne attendue, sinon erreur");
});

test("G2-B: findFeature retourne null sur 0 ligne (maybeSingle ne lève pas)", async () => {
  const { client } = makeClient([{ data: null, error: null }]);
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  const result = await repo.findFeature(GUILD_ID, EntitlementFeature.WELCOME_IMAGE);
  assert.equal(result, null);
});

test("G2-B: findFeature retourne la ligne présente", async () => {
  const row = { guild_id: GUILD_ID, feature_key: EntitlementFeature.WELCOME_IMAGE, status: "active", ends_at: null };
  const { client } = makeClient([{ data: row, error: null }]);
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  const result = await repo.findFeature(GUILD_ID, EntitlementFeature.WELCOME_IMAGE);
  assert.deepEqual(result, row);
});

test("G2-B: findFeature propage l'erreur PostgREST", async () => {
  const { client } = makeClient([{ data: null, error: { code: "42501", message: "permission denied" } }]);
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  await assert.rejects(() => repo.findFeature(GUILD_ID, EntitlementFeature.WELCOME_IMAGE), (error) => error.code === "42501");
});

// ───────────────────────────────────────────────────────────────
// setStatus — guilde ordinaire (aucun permit requis)
// ───────────────────────────────────────────────────────────────

test("G2-B: setStatus sur guilde ordinaire émet update({status}).eq(guild_id).eq(feature_key)", async () => {
  const { client, calls } = makeClient([{ data: null, error: null }]);
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  await repo.setStatus(GUILD_ID, EntitlementFeature.TICKET_PREMIUM, "revoked");

  assert.equal(calls.length, 1, "une seule écriture, sans preflight Supabase");
  const call = calls[0];
  assert.equal(call.table, "guild_entitlements");
  assert.equal(call.op, "update");
  assert.deepEqual(call.payload, { status: "revoked" });
  assert.deepEqual(call.filters, [
    ["guild_id", GUILD_ID],
    ["feature_key", EntitlementFeature.TICKET_PREMIUM],
  ]);
});

test("G2-B: setStatus propage l'erreur PostgREST", async () => {
  const { client } = makeClient([{ data: null, error: { code: "PGRST301", message: "RLS" } }]);
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  await assert.rejects(() => repo.setStatus(GUILD_ID, EntitlementFeature.TICKET_PREMIUM, "revoked"), (error) => error.code === "PGRST301");
});

// ───────────────────────────────────────────────────────────────
// activate — guilde ordinaire (upsert sans permit)
// ───────────────────────────────────────────────────────────────

test("G2-B: activate sur guilde ordinaire émet upsert avec onConflict guild_id,feature_key", async () => {
  const { client, calls } = makeClient([{ data: null, error: null }]);
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  const record = {
    guild_id: GUILD_ID,
    feature_key: EntitlementFeature.WELCOME_IMAGE,
    status: "active",
    starts_at: "2026-01-01T00:00:00.000Z",
    ends_at: null,
    plan: EntitlementFeature.WELCOME_IMAGE,
  };
  await repo.activate(record);

  assert.equal(calls.length, 1, "aucun appel supplémentaire pour une guilde ordinaire");
  const call = calls[0];
  assert.equal(call.table, "guild_entitlements");
  assert.equal(call.op, "upsert");
  assert.deepEqual(call.payload, record, "le record complet est upserté");
  assert.equal(call.onConflict, "guild_id,feature_key", "l'upsert cible la clé unique du couple");
});

test("G2-B: activate propage l'erreur PostgREST", async () => {
  const { client } = makeClient([{ data: null, error: { code: "42703", message: "column does not exist" } }]);
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  await assert.rejects(
    () => repo.activate({ guild_id: GUILD_ID, feature_key: EntitlementFeature.WELCOME_IMAGE, status: "active" }),
    (error) => error.code === "42703",
  );
});
