"use strict";

// ───────────────────────────────────────────────────────────────
// 4F-2b — classification des erreurs PostgREST dans les repositories
// Supabase autorisés (AdminAudit + CivratIdentity). Les trois autres
// repositories du périmètre (PremiumHistory, Analytics, TicketCounter)
// sont couverts par leurs propres suites de tests.
//
// Avant 4F-2b, ces repositories re-lançaient l'objet PostgREST BRUT
// (`if (error) throw error`), ce qui rendait un refus RLS, une table
// absente et une coupure réseau indistinguables pour les appelants.
// Désormais `toPersistenceError` les classe :
//   42501 (RLS)                => PERSISTENCE_PERMISSION_DENIED
//   42P01 / 42883 / PGRST2xx   => PERSISTENCE_SCHEMA_MISMATCH
//   23505 / 23502 / 23503      => PERSISTENCE_CONFLICT
//   ECONNREFUSED / 5xx / …     => BackendUnavailableError (retryable)
//   tout le reste              => PERSISTENCE_FAILED
// L'erreur PostgREST d'origine reste disponible via `cause`, et les
// métadonnées portent `operation` + `resource` pour l'observabilité.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const { ErrorCode, BackendUnavailableError } = require("../../src/core/errors");
const { SupabaseAdminAuditRepository } = require("../../src/modules/admin-panel/persistence/SupabaseAdminAuditRepository");
const { SupabaseCivratIdentityRepository } = require("../../src/modules/owner-panel/persistence/SupabaseCivratIdentityRepository");

/** Faux client PostgREST chaînable qui rejoue une séquence de `results`. */
function makeClient(results = []) {
  const calls = [];
  let index = 0;
  function builder(table) {
    const api = {
      select: () => api,
      insert: () => api,
      update: () => api,
      upsert: () => api,
      delete: () => api,
      eq: () => api,
      order: () => api,
      range: () => api,
      limit: () => api,
      maybeSingle: () => api,
      single: () => api,
      then(resolve) {
        calls.push(table);
        const result = results[index] || { data: null, error: null };
        index += 1;
        return Promise.resolve(result).then(resolve);
      },
    };
    return api;
  }
  return { client: { from: builder }, calls };
}

const errorFor = (code, message) => ({ code, message });

test("4F-2b/AdminAudit — un refus RLS (42501) est classé PERSISTENCE_PERMISSION_DENIED", async () => {
  const raw = errorFor("42501", "permission denied for table civrat_admin_audit");
  const { client } = makeClient([{ data: null, error: raw }]);
  const repo = new SupabaseAdminAuditRepository({ supabase: client });

  await assert.rejects(() => repo.append({ actorId: "a", action: "x" }), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_PERMISSION_DENIED);
    assert.equal(error.metadata.classification, "PERMISSION_DENIED");
    assert.equal(error.metadata.operation, "append");
    assert.equal(error.metadata.resource, "civrat_admin_audit");
    assert.equal(error.cause, raw);
    return true;
  });
});

test("4F-2b/AdminAudit — une coupure réseau est classée BackendUnavailableError (retryable)", async () => {
  const raw = errorFor("ECONNREFUSED", "fetch failed");
  const { client } = makeClient([{ data: null, error: raw }]);
  const repo = new SupabaseAdminAuditRepository({ supabase: client });

  await assert.rejects(() => repo.list({}), (error) => {
    assert.ok(error instanceof BackendUnavailableError);
    assert.equal(error.code, ErrorCode.BACKEND_UNAVAILABLE);
    assert.equal(error.retryable, true);
    assert.equal(error.metadata.operation, "list");
    return true;
  });
});

test("4F-2b/AdminAudit — une table absente (42P01) est classée PERSISTENCE_SCHEMA_MISMATCH", async () => {
  const raw = errorFor("42P01", 'relation "civrat_admin_audit" does not exist');
  const { client } = makeClient([{ data: null, error: raw }]);
  const repo = new SupabaseAdminAuditRepository({ supabase: client });

  await assert.rejects(() => repo.count({}), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_SCHEMA_MISMATCH);
    assert.equal(error.metadata.operation, "count");
    return true;
  });
});

test("4F-2b/CivratIdentity — readOwnerId classe un refus RLS sans altérer le contrat null", async () => {
  const raw = errorFor("42501", "permission denied for table civrat_owner_state");
  const { client } = makeClient([{ data: null, error: raw }]);
  const repo = new SupabaseCivratIdentityRepository({ supabase: client });

  await assert.rejects(() => repo.readOwnerId(), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_PERMISSION_DENIED);
    assert.equal(error.metadata.operation, "readOwnerId");
    assert.equal(error.metadata.resource, "civrat_owner_state");
    return true;
  });
});

test("4F-2b/CivratIdentity — writeOwnerId classe un conflit (23505) en PERSISTENCE_CONFLICT", async () => {
  const raw = errorFor("23505", 'duplicate key value violates unique constraint "civrat_owner_state_pkey"');
  const { client } = makeClient([{ data: null, error: raw }]);
  const repo = new SupabaseCivratIdentityRepository({ supabase: client });

  await assert.rejects(() => repo.writeOwnerId("owner-1"), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_CONFLICT);
    assert.equal(error.metadata.operation, "writeOwnerId");
    return true;
  });
});

test("4F-2b/CivratIdentity — readAdminIds classe une indisponibilité backend", async () => {
  const raw = errorFor("ECONNREFUSED", "fetch failed");
  const { client } = makeClient([{ data: null, error: raw }]);
  const repo = new SupabaseCivratIdentityRepository({ supabase: client });

  await assert.rejects(() => repo.readAdminIds(), (error) => {
    assert.ok(error instanceof BackendUnavailableError);
    assert.equal(error.metadata.operation, "readAdminIds");
    assert.equal(error.metadata.resource, "civrat_admins");
    return true;
  });
});

test("4F-2b/CivratIdentity — addAdmin/removeAdmin propagent une erreur classée", async () => {
  const raw = errorFor("42501", "permission denied for table civrat_admins");
  const { client } = makeClient([{ data: null, error: raw }, { data: null, error: raw }]);
  const repo = new SupabaseCivratIdentityRepository({ supabase: client });

  await assert.rejects(() => repo.addAdmin("u1"), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_PERMISSION_DENIED);
    assert.equal(error.metadata.operation, "addAdmin");
    return true;
  });

  await assert.rejects(() => repo.removeAdmin("u1"), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_PERMISSION_DENIED);
    assert.equal(error.metadata.operation, "removeAdmin");
    return true;
  });
});

test("4F-2b/CivratIdentity — transferOwnership classe l'erreur de la 2e écriture", async () => {
  const raw = errorFor("42883", "function does not exist");
  // 1re écriture (writeOwnerId) réussit, la 2e (retrait admin) échoue.
  const { client } = makeClient([{ data: null, error: null }, { data: null, error: raw }]);
  const repo = new SupabaseCivratIdentityRepository({ supabase: client });

  await assert.rejects(() => repo.transferOwnership({ newOwnerId: "owner-2" }), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_SCHEMA_MISMATCH);
    assert.equal(error.metadata.operation, "transferOwnership");
    assert.equal(error.metadata.resource, "civrat_admins");
    return true;
  });
});

test("4F-2b — une erreur non reconnue retombe sur PERSISTENCE_FAILED (jamais muette)", async () => {
  const raw = errorFor("XX000", "something odd happened");
  const { client } = makeClient([{ data: null, error: raw }]);
  const repo = new SupabaseAdminAuditRepository({ supabase: client });

  await assert.rejects(() => repo.append({ actorId: "a", action: "x" }), (error) => {
    assert.equal(error.code, ErrorCode.PERSISTENCE_FAILED);
    assert.equal(error.metadata.classification, "UNKNOWN");
    assert.equal(error.cause, raw, "la cause brute est conservée pour diagnostic");
    return true;
  });
});
