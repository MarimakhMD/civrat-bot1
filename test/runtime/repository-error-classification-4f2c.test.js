"use strict";

// ─────────────────────────────────────────────────────────────────────────
// 4F-2c — classification des erreurs PostgREST dans SupabaseTicketRepository,
// AVEC préservation de l'anti-double-ouverture 23505 → OPEN_TICKET_EXISTS.
//
// Contrat verrouillé :
//   create()  : error.code === "23505" remonte BRUT (garde explicite avant
//               toPersistenceError) pour que TicketService réponde
//               OPEN_TICKET_EXISTS et déclenche le rollback `unique_violation`.
//               Toute autre erreur (42501 RLS, 42P01/42703 schéma, réseau)
//               est classifiée.
//   findOpen() / findByChannel() / updateByChannel() : erreurs classifiées.
//
// Les comportements 4G (guild scope, fail-closed, projection TICKET_COLUMNS)
// sont re-vérifiés ici : ils ne doivent pas être altérés par la classification.
// ─────────────────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const { ErrorCode, BackendUnavailableError } = require("../../src/core/errors");
const { SupabaseTicketRepository, TICKET_COLUMNS } = require("../../src/modules/tickets/persistence/SupabaseTicketRepository");
const { TicketService } = require("../../src/modules/tickets/services/TicketService");

/** Faux client PostgREST chaînable qui rejoue une erreur par opération. */
function makeSelectClient(errorResult) {
  const filters = [];
  let projected = null;
  const api = {
    select(columns) { projected = columns; return api; },
    eq(column, value) { filters.push([column, value]); return api; },
    in() { return api; },
    order() { return api; },
    limit() { return api; },
    range() { return api; },
    maybeSingle: async () => ({ data: null, error: errorResult }),
    single: async () => ({ data: null, error: errorResult }),
  };
  return { from: () => api, filters, get projected() { return projected; } };
}

function errorFor(code, message) { return { code, message }; }

// ─────────────────────────────────────────────────────────────────────────
// create() — le contrat 23505
// ─────────────────────────────────────────────────────────────────────────

test("4F-2c/create — 23505 reste brut : error.code === \"23505\" et cause absente", async () => {
  const raw = errorFor("23505", 'duplicate key value violates unique constraint "idx_tickets_open_unique"');
  const repo = new SupabaseTicketRepository({
    supabase: { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: raw }) }) }) }) },
  });

  await assert.rejects(() => repo.create({ guild_id: "g" }), (error) => {
    assert.equal(error.code, "23505", "le code brut est préservé pour TicketService");
    assert.equal(error, raw, "l'objet PostgREST d'origine est re-lancé tel quel");
    assert.equal(error.cause, undefined, "aucune ré-encapsulation : pas de PersistenceError");
    return true;
  });
});

test("4F-2c/create — 42501 (RLS) est classifié PERSISTENCE_PERMISSION_DENIED", async () => {
  const raw = errorFor("42501", "permission denied for table tickets");
  const repo = new SupabaseTicketRepository({
    supabase: { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: raw }) }) }) }) },
  });

  await assert.rejects(() => repo.create({ guild_id: "g" }), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_PERMISSION_DENIED);
    assert.equal(error.metadata.classification, "PERMISSION_DENIED");
    assert.equal(error.metadata.operation, "create");
    assert.equal(error.metadata.resource, "tickets");
    assert.equal(error.cause, raw);
    return true;
  });
});

test("4F-2c/create — réseau indisponible est classifié BackendUnavailableError", async () => {
  const raw = errorFor("ECONNREFUSED", "fetch failed");
  const repo = new SupabaseTicketRepository({
    supabase: { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: raw }) }) }) }) },
  });

  await assert.rejects(() => repo.create({ guild_id: "g" }), (error) => {
    assert.ok(error instanceof BackendUnavailableError);
    assert.equal(error.code, ErrorCode.BACKEND_UNAVAILABLE);
    assert.equal(error.retryable, true);
    return true;
  });
});

test("4F-2c/create — 42703 (colonne absente) est classifié PERSISTENCE_SCHEMA_MISMATCH", async () => {
  const raw = errorFor("42703", 'column "panel_id" of relation "tickets" does not exist');
  const repo = new SupabaseTicketRepository({
    supabase: { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: raw }) }) }) }) },
  });

  await assert.rejects(() => repo.create({ guild_id: "g" }), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_SCHEMA_MISMATCH);
    assert.equal(error.metadata.classification, "SCHEMA_MISMATCH");
    return true;
  });
});

// ─────────────────────────────────────────────────────────────────────────
// create() — 23505 BOUT EN BOUT : TicketService → OPEN_TICKET_EXISTS +
// rollback `unique_violation`.
// ─────────────────────────────────────────────────────────────────────────

test("4F-2c/bout-en-bout — un 23505 sur create() donne OPEN_TICKET_EXISTS et un rollback unique_violation", async () => {
  const logs = [];
  const channel = { id: "chan-1" };
  let deleted = null;

  // Faux client : findOpen → aucun ticket ouvert, create → 23505.
  const supabase = {
    from: () => ({
      select: () => {
        const chain = {
          eq: () => chain,
          in: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return chain;
      },
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }),
        }),
      }),
    }),
  };

  const service = new TicketService({
    repository: new SupabaseTicketRepository({ supabase }),
    configService: { read: async () => ({ tickets_enabled: true, ticket_category_id: "cat", ticket_support_role_id: "sup" }) },
    counterRepository: { next: async () => 1 },
    channelNamingService: { build: () => "ticket-001" },
    premiumConfigResolver: null,
    transport: {
      getCategory: async () => ({ id: "cat" }),
      getSupportRole: async () => ({ id: "sup" }),
      getMember: async (id) => ({ id }),
      getBotMember: async () => ({ id: "bot" }),
      createTicketChannel: async () => channel,
      applyTicketOverwrites: async () => ({ applied: true }),
      deleteTicketChannel: async (id) => { deleted = id; },
    },
    ticketLog: (event) => logs.push(event),
  });

  const result = await service.createTicket({ guildId: "g", member: { id: "member" } });

  assert.equal(result.code, "OPEN_TICKET_EXISTS", "le 23505 est bien traduit en OPEN_TICKET_EXISTS");
  assert.equal(result.created, false);
  assert.equal(result.details.channelId, "chan-1", "le salon créé avant l'INSERT est référencé");

  // Le salon Discord créé AVANT l'INSERT doit être compensé, avec la cause exacte.
  assert.equal(deleted, "chan-1", "rollback du salon créé avant l'échec d'insertion");
  const rollback = logs.find((e) => e.action === "ticket_creation_rolled_back");
  assert.ok(rollback, "le rollback est journalisé");
  assert.equal(rollback.reason, "unique_violation", "la cause est `unique_violation`, pas `persistence`");
});

// ─────────────────────────────────────────────────────────────────────────
// findOpen() / findByChannel() — erreurs classifiées
// ─────────────────────────────────────────────────────────────────────────

test("4F-2c/findOpen — 42501 est classifié PERSISTENCE_PERMISSION_DENIED", async () => {
  const raw = errorFor("42501", "permission denied for table tickets");
  const repo = new SupabaseTicketRepository({ supabase: makeSelectClient(raw) });

  await assert.rejects(() => repo.findOpen("g", "u"), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_PERMISSION_DENIED);
    assert.equal(error.metadata.operation, "findOpen");
    return true;
  });
});

test("4F-2c/findOpen — 42P01 (table absente) est classifié PERSISTENCE_SCHEMA_MISMATCH", async () => {
  const raw = errorFor("42P01", 'relation "tickets" does not exist');
  const repo = new SupabaseTicketRepository({ supabase: makeSelectClient(raw) });

  await assert.rejects(() => repo.findOpen("g", "u"), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_SCHEMA_MISMATCH);
    assert.equal(error.metadata.classification, "SCHEMA_MISMATCH");
    return true;
  });
});

test("4F-2c/findOpen — réseau indisponible est classifié BackendUnavailableError", async () => {
  const raw = errorFor("ETIMEDOUT", "network error");
  const repo = new SupabaseTicketRepository({ supabase: makeSelectClient(raw) });

  await assert.rejects(() => repo.findOpen("g", "u"), (error) => {
    assert.ok(error instanceof BackendUnavailableError);
    assert.equal(error.retryable, true);
    return true;
  });
});

test("4F-2c/findByChannel — 42501 est classifié PERSISTENCE_PERMISSION_DENIED", async () => {
  const raw = errorFor("42501", "permission denied for table tickets");
  const repo = new SupabaseTicketRepository({ supabase: makeSelectClient(raw) });

  await assert.rejects(() => repo.findByChannel("g", "c"), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_PERMISSION_DENIED);
    assert.equal(error.metadata.operation, "findByChannel");
    return true;
  });
});

test("4F-2c/findByChannel — réseau indisponible est classifié BackendUnavailableError", async () => {
  const raw = errorFor("ECONNREFUSED", "fetch failed");
  const repo = new SupabaseTicketRepository({ supabase: makeSelectClient(raw) });

  await assert.rejects(() => repo.findByChannel("g", "c"), (error) => {
    assert.ok(error instanceof BackendUnavailableError);
    return true;
  });
});

// ─────────────────────────────────────────────────────────────────────────
// updateByChannel() — PGRST116 / 42501 / réseau
// ─────────────────────────────────────────────────────────────────────────

function makeUpdateClient(errorResult) {
  const filters = [];
  const api = {
    update() {
      const chain = {
        eq(column, value) { filters.push([column, value]); return chain; },
        select: () => ({ single: async () => ({ data: null, error: errorResult }) }),
      };
      return chain;
    },
  };
  return { from: () => api, filters };
}

test("4F-2c/updateByChannel — PGRST116 (0 ligne) est classifié PERSISTENCE_FAILED", async () => {
  const raw = errorFor("PGRST116", "no row matched");
  const repo = new SupabaseTicketRepository({ supabase: makeUpdateClient(raw) });

  await assert.rejects(() => repo.updateByChannel("g", "c", { closed: true }), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_FAILED);
    assert.equal(error.metadata.classification, "NOT_FOUND");
    assert.equal(error.cause.code, "PGRST116", "la cause brute conserve PGRST116");
    return true;
  });
});

test("4F-2c/updateByChannel — 42501 est classifié PERSISTENCE_PERMISSION_DENIED", async () => {
  const raw = errorFor("42501", "permission denied for table tickets");
  const repo = new SupabaseTicketRepository({ supabase: makeUpdateClient(raw) });

  await assert.rejects(() => repo.updateByChannel("g", "c", { status: "claimed" }), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_PERMISSION_DENIED);
    assert.equal(error.metadata.operation, "updateByChannel");
    return true;
  });
});

test("4F-2c/updateByChannel — réseau indisponible est classifié BackendUnavailableError", async () => {
  const raw = errorFor("ECONNREFUSED", "fetch failed");
  const repo = new SupabaseTicketRepository({ supabase: makeUpdateClient(raw) });

  await assert.rejects(() => repo.updateByChannel("g", "c", { status: "closed" }), (error) => {
    assert.ok(error instanceof BackendUnavailableError);
    return true;
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4G intact — guild scope, fail-closed, projection TICKET_COLUMNS.
// ─────────────────────────────────────────────────────────────────────────

test("4F-2c/4G — findByChannel et findOpen conservent la projection minimale TICKET_COLUMNS", async () => {
  const projected = [];
  const supabase = {
    from: () => {
      const chain = {
        select(columns) { projected.push(columns); return chain; },
        eq() { return chain; },
        in() { return chain; },
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };
  const repo = new SupabaseTicketRepository({ supabase });

  await repo.findByChannel("g", "c");
  await repo.findOpen("g", "u");

  assert.equal(projected.length, 2);
  for (const p of projected) {
    assert.equal(p, TICKET_COLUMNS, "la projection reste réduite aux cinq colonnes lues");
  }
});

test("4F-2c/4G — findByChannel et updateByChannel restent scopés par guild_id ET channel_id", async () => {
  const filters = [];
  const supabase = {
    from: () => {
      const selectChain = {
        select() { return selectChain; },
        eq(column, value) { filters.push([column, value]); return selectChain; },
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return {
        select: () => selectChain,
        update() {
          const chain = {
            eq(column, value) { filters.push([column, value]); return chain; },
            select: () => ({ single: async () => ({ data: null, error: null }) }),
          };
          return chain;
        },
      };
    },
  };
  const repo = new SupabaseTicketRepository({ supabase });

  await repo.findByChannel("GUILDE-A", "chan-1");
  await repo.updateByChannel("GUILDE-A", "chan-1", { closed: true });

  assert.deepEqual(
    filters,
    [["guild_id", "GUILDE-A"], ["channel_id", "chan-1"], ["guild_id", "GUILDE-A"], ["channel_id", "chan-1"]],
    "guild_id précède channel_id sur lecture ET écriture",
  );
});

test("4F-2c/4G — fail-closed conservé : findByChannel renvoie null, updateByChannel lève TypeError, sans requête", async () => {
  let queried = 0;
  const repo = new SupabaseTicketRepository({ supabase: { from: () => { queried += 1; throw new Error("should not be reached"); } } });

  assert.equal(await repo.findByChannel(null, "chan-1"), null);
  assert.equal(await repo.findByChannel("g", null), null);
  await assert.rejects(() => repo.updateByChannel(null, "chan-1", { closed: true }), TypeError);
  await assert.rejects(() => repo.updateByChannel("g", null, { closed: true }), TypeError);

  assert.equal(queried, 0, "aucune requête émise : fail-closed");
});
