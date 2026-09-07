"use strict";

// ───────────────────────────────────────────────────────────────
// G2-A — SupabasePremiumHistoryRepository.append + #appendHistory.
//
// Verrouille le dépôt Supabase réel (jamais une vraie base : un faux client
// journalise les requêtes émises) :
//   1. le mapping EXACT des colonnes de `guild_entitlement_history` ;
//   2. la classification des erreurs PostgREST via `toPersistenceError`
//      (4F-2b : permission denied, conflit, réseau/backend indisponible) ;
//   3. le comportement de `AdminPanelService.#appendHistory` quand `append()`
//      échoue : l'activation Premium reste RÉUSSIE et un log
//      `premium_history_append_failed` est émis (l'historique ne doit jamais
//      annuler une opération Premium) ;
//   4. la conservation du tri `created_at DESC` (listByGuild + listRecent).
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const { SupabasePremiumHistoryRepository } = require("../persistence/SupabasePremiumHistoryRepository");
const { EntitlementService, EntitlementFeature } = require("../../../core/entitlements");
const { AdminPanelService } = require("../services/AdminPanelService");
const { ErrorCode, BackendUnavailableError } = require("../../../core/errors");

const GUILD_ID = "111111111111111111";
const ACTOR_ID = "222222222222222222";

/** Faux client PostgREST : journalise la chaîne et rejoue `results`. */
function makeClient(results = []) {
  const calls = [];
  let resultIndex = 0;
  function builder(table) {
    const state = {
      table, columns: null, op: null, payload: null, onConflict: null,
      filters: [], orders: [], limit: null, range: null, terminal: null,
    };
    const api = {
      select(columns) { state.columns = columns ?? "*"; return api; },
      insert(payload) { state.op = "insert"; state.payload = payload; return api; },
      update(payload) { state.op = "update"; state.payload = payload; return api; },
      upsert(payload, options) { state.op = "upsert"; state.payload = payload; state.onConflict = options?.onConflict ?? null; return api; },
      eq(column, value) { state.filters.push([column, value]); return api; },
      order(column, options) { state.orders.push({ column, ascending: options?.ascending !== false }); return api; },
      limit(value) { state.limit = value; return api; },
      range(from, to) { state.range = { from, to }; return api; },
      maybeSingle() { state.terminal = "maybeSingle"; return api; },
      single() { state.terminal = "single"; return api; },
      then(resolve, reject) {
        calls.push({
          table: state.table, columns: state.columns, op: state.op, payload: state.payload,
          onConflict: state.onConflict, filters: state.filters.map((f) => [...f]),
          orders: state.orders.map((o) => ({ ...o })), limit: state.limit,
          range: state.range ? { ...state.range } : null, terminal: state.terminal,
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

const fullEntry = () => ({
  guildId: GUILD_ID,
  feature: EntitlementFeature.TICKET_PREMIUM,
  action: "activate",
  actorId: ACTOR_ID,
  oldStatus: "inactive",
  newStatus: "active",
  oldEndsAt: null,
  newEndsAt: null,
  plan: EntitlementFeature.TICKET_PREMIUM,
  reason: "granted by owner",
});

// ───────────────────────────────────────────────────────────────
// 1 · Mapping exact des colonnes de `guild_entitlement_history`
// ───────────────────────────────────────────────────────────────

test("G2-A: append mappe exactement les colonnes documentées, avec fallbacks null", async () => {
  const { client, calls } = makeClient([{ data: null, error: null }]);
  const repo = new SupabasePremiumHistoryRepository({ supabase: client });

  await repo.append(fullEntry());

  assert.equal(calls.length, 1, "une seule insertion");
  const call = calls[0];
  assert.equal(call.table, "guild_entitlement_history");
  assert.equal(call.op, "insert");

  const payload = call.payload;
  // Clé par clé : aucun champ en trop, aucun champ manquant.
  assert.deepEqual(Object.keys(payload).sort(), [
    "action", "actor_id", "created_at", "feature_key", "guild_id",
    "new_ends_at", "new_status", "old_ends_at", "old_status", "plan", "reason",
  ].sort());
  assert.equal(payload.guild_id, GUILD_ID);
  assert.equal(payload.feature_key, EntitlementFeature.TICKET_PREMIUM);
  assert.equal(payload.action, "activate");
  assert.equal(payload.actor_id, ACTOR_ID);
  assert.equal(payload.old_status, "inactive");
  assert.equal(payload.new_status, "active");
  assert.equal(payload.old_ends_at, null);
  assert.equal(payload.new_ends_at, null);
  assert.equal(payload.plan, EntitlementFeature.TICKET_PREMIUM);
  assert.equal(payload.reason, "granted by owner");
  assert.equal(typeof payload.created_at, "string", "created_at est horodaté en string");
  assert.ok(!Number.isNaN(Date.parse(payload.created_at)), "created_at est une date ISO valide");
});

test("G2-A: les champs absents de l'entrée tombent sur null, jamais sur undefined", async () => {
  const { client, calls } = makeClient([{ data: null, error: null }]);
  const repo = new SupabasePremiumHistoryRepository({ supabase: client });

  await repo.append({ guildId: GUILD_ID, feature: "WELCOME_IMAGE", action: "activate", actorId: ACTOR_ID });

  const payload = calls[0].payload;
  assert.equal(payload.old_status, null);
  assert.equal(payload.new_status, null);
  assert.equal(payload.old_ends_at, null);
  assert.equal(payload.new_ends_at, null);
  assert.equal(payload.plan, null);
  assert.equal(payload.reason, null);
});

// ───────────────────────────────────────────────────────────────
// 2 · Classification des erreurs PostgREST (4F-2b)
// ───────────────────────────────────────────────────────────────

test("G2-A: append classe un conflit PostgREST (23502) en PERSISTENCE_CONFLICT", async () => {
  const postgrestError = { code: "23502", message: "null value in column \"actor_id\"" };
  const { client } = makeClient([{ data: null, error: postgrestError }]);
  const repo = new SupabasePremiumHistoryRepository({ supabase: client });

  await assert.rejects(() => repo.append(fullEntry()), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_CONFLICT);
    assert.equal(error.metadata.classification, "CONFLICT");
    assert.equal(error.metadata.operation, "append");
    assert.equal(error.cause, postgrestError, "l'erreur PostgREST d'origine reste la cause");
    return true;
  });
});

test("G2-A: append classe un refus RLS (42501) en PERSISTENCE_PERMISSION_DENIED", async () => {
  const postgrestError = { code: "42501", message: "new row violates row-level security policy" };
  const { client } = makeClient([{ data: null, error: postgrestError }]);
  const repo = new SupabasePremiumHistoryRepository({ supabase: client });

  await assert.rejects(() => repo.append(fullEntry()), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_PERMISSION_DENIED);
    assert.equal(error.metadata.classification, "PERMISSION_DENIED");
    return true;
  });
});

test("G2-A: append classe une indisponibilité réseau en BackendUnavailableError", async () => {
  const networkError = { code: "ECONNREFUSED", message: "fetch failed" };
  const { client } = makeClient([{ data: null, error: networkError }]);
  const repo = new SupabasePremiumHistoryRepository({ supabase: client });

  await assert.rejects(() => repo.append(fullEntry()), (error) => {
    assert.ok(error instanceof BackendUnavailableError, "réseau => BackendUnavailableError");
    assert.equal(error.code, ErrorCode.BACKEND_UNAVAILABLE);
    assert.equal(error.retryable, true, "l'indisponibilité backend est retentable");
    return true;
  });
});

// ───────────────────────────────────────────────────────────────
// 3 · #appendHistory : l'échec de l'historique n'annule pas Premium
// ───────────────────────────────────────────────────────────────

class MemoryEntitlementRepository {
  constructor(rows = []) { this.rows = rows.map((r) => ({ ...r })); }
  async findFeature(guildId, feature) { return this.rows.find((r) => r.guild_id === guildId && r.feature_key === feature) || null; }
  async listFeatures(guildId) { return this.rows.filter((r) => r.guild_id === guildId); }
  async listAll() { return { rows: [...this.rows], totalRows: this.rows.length, truncated: false }; }
  async activate(record) {
    const i = this.rows.findIndex((r) => r.guild_id === record.guild_id && r.feature_key === record.feature_key);
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...record };
    else this.rows.push({ ...record });
  }
  async setStatus(guildId, feature, status) {
    const r = this.rows.find((x) => x.guild_id === guildId && x.feature_key === feature);
    if (r) r.status = status;
  }
}

test("G2-A: un append() qui échoue n'annule pas l'activation Premium (log attendu)", async () => {
  const logs = [];
  const logger = { info: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a) };

  const entitlementService = new EntitlementService({ repository: new MemoryEntitlementRepository() });
  const failingHistoryRepository = {
    append: async () => { throw new Error("history db down"); },
    listByGuild: async () => [],
  };
  const auditRepository = { entries: [], append: async function append(entry) { this.entries.push(entry); }, list: async () => [], count: async () => 0 };

  const service = new AdminPanelService({ entitlementService, historyRepository: failingHistoryRepository, auditRepository, logger });

  const result = await service.activatePremium({
    actorId: ACTOR_ID,
    guildId: GUILD_ID,
    plan: EntitlementFeature.TICKET_PREMIUM,
  });

  assert.equal(result.ok, true, "l'activation Premium reste réussie");
  assert.equal(result.code, "PREMIUM_ACTIVATED");

  const row = await entitlementService.findFeature(GUILD_ID, EntitlementFeature.TICKET_PREMIUM);
  assert.equal(row.status, "active", "l'écriture de l'entitlement a bien eu lieu");

  assert.equal(auditRepository.entries.length, 1, "l'audit n'est pas impacté par l'échec de l'historique");
  assert.equal(auditRepository.entries[0].action, "premium.activate");

  // AdminPanelService.log() émet logger.info("admin_panel_event", { event, ... }).
  const historyFailure = logs.find((entry) => entry[1] && entry[1].event === "premium_history_append_failed");
  assert.ok(historyFailure, "l'échec d'historique est journalisé sous premium_history_append_failed");
});

// ───────────────────────────────────────────────────────────────
// 4 · Tri `created_at DESC` conservé
// ───────────────────────────────────────────────────────────────

test("G2-A: listByGuild et listRecent conservent l'ordre created_at DESC", async () => {
  const { client, calls } = makeClient([{ data: [], error: null }, { data: [], error: null }]);
  const repo = new SupabasePremiumHistoryRepository({ supabase: client });

  await repo.listByGuild(GUILD_ID, { limit: 5, offset: 0 });
  await repo.listRecent({ limit: 5 });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    const order = call.orders.find((o) => o.column === "created_at");
    assert.ok(order, "un tri sur created_at est émis");
    assert.equal(order.ascending, false, "tri décroissant (les plus récents d'abord)");
  }
});
