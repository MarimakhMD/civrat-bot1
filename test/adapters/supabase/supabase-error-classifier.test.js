"use strict";

// ───────────────────────────────────────────────────────────────
// 4F-2a — test dédié du classifier Supabase.
//
// Verrouille `classifySupabaseError` et `toPersistenceError` sur tous les
// mappings importants, y compris les cas regroupés sous PERSISTENCE_FAILED
// (décision B : NOT_FOUND / VALIDATION_FAILED / UNKNOWN), les signaux
// réseau/HTTP, et la non-fuite de texte backend dans les metadata.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SupabaseErrorCategory,
  classifySupabaseError,
  toPersistenceError,
} = require("../../../src/adapters/supabase/supabaseErrorClassifier");
const {
  ErrorCode,
  BackendUnavailableError,
  PersistenceError,
} = require("../../../src/core/errors");

// ═══════════════════════════════════════════════════════════════
// classifySupabaseError — catégories
// ═══════════════════════════════════════════════════════════════

test("4F-2a: SCHEMA_MISMATCH (42P01 / 42703 / PGRST204)", () => {
  assert.equal(classifySupabaseError({ code: "42P01" }).category, SupabaseErrorCategory.SCHEMA_MISMATCH);
  assert.equal(classifySupabaseError({ code: "42703" }).category, SupabaseErrorCategory.SCHEMA_MISMATCH);
  assert.equal(classifySupabaseError({ code: "PGRST204" }).category, SupabaseErrorCategory.SCHEMA_MISMATCH);
});

test("4F-2a: PERMISSION_DENIED (42501 / PGRST301 / HTTP 401/403)", () => {
  assert.equal(classifySupabaseError({ code: "42501" }).category, SupabaseErrorCategory.PERMISSION_DENIED);
  assert.equal(classifySupabaseError({ code: "PGRST301" }).category, SupabaseErrorCategory.PERMISSION_DENIED);
  assert.equal(classifySupabaseError({ code: null, status: 401 }).category, SupabaseErrorCategory.PERMISSION_DENIED);
  assert.equal(classifySupabaseError({ code: null, status: 403 }).category, SupabaseErrorCategory.PERMISSION_DENIED);
});

test("4F-2a: CONFLICT (23505 / HTTP 409)", () => {
  assert.equal(classifySupabaseError({ code: "23505" }).category, SupabaseErrorCategory.CONFLICT);
  assert.equal(classifySupabaseError({ code: null, status: 409 }).category, SupabaseErrorCategory.CONFLICT);
});

test("4F-2a: NOT_FOUND (PGRST116)", () => {
  assert.equal(classifySupabaseError({ code: "PGRST116" }).category, SupabaseErrorCategory.NOT_FOUND);
});

test("4F-2a: VALIDATION_FAILED (22P02 / HTTP 400/422)", () => {
  assert.equal(classifySupabaseError({ code: "22P02" }).category, SupabaseErrorCategory.VALIDATION_FAILED);
  assert.equal(classifySupabaseError({ code: null, status: 400 }).category, SupabaseErrorCategory.VALIDATION_FAILED);
  assert.equal(classifySupabaseError({ code: null, status: 422 }).category, SupabaseErrorCategory.VALIDATION_FAILED);
});

test("4F-2a: BACKEND_UNAVAILABLE (réseau / HTTP 5xx / 429)", () => {
  for (const err of [{ code: "ECONNRESET" }, { code: "ETIMEDOUT" }, { code: null, status: 503 }, { code: null, status: 429 }, { code: null, message: "fetch failed" }]) {
    assert.equal(classifySupabaseError(err).category, SupabaseErrorCategory.BACKEND_UNAVAILABLE);
  }
});

test("4F-2a: UNKNOWN par défaut", () => {
  assert.equal(classifySupabaseError({ code: "XYZ" }).category, SupabaseErrorCategory.UNKNOWN);
  assert.equal(classifySupabaseError({}).category, SupabaseErrorCategory.UNKNOWN);
});

// ═══════════════════════════════════════════════════════════════
// toPersistenceError — correspondance des codes CivratError
// ═══════════════════════════════════════════════════════════════

test("4F-2a: BACKEND_UNAVAILABLE → BackendUnavailableError", () => {
  const mapped = toPersistenceError({ code: "ECONNRESET" });
  assert.ok(mapped instanceof BackendUnavailableError);
  assert.equal(mapped.code, ErrorCode.BACKEND_UNAVAILABLE);
});

test("4F-2a: SCHEMA_MISMATCH → PERSISTENCE_SCHEMA_MISMATCH", () => {
  assert.equal(toPersistenceError({ code: "42703" }).code, ErrorCode.PERSISTENCE_SCHEMA_MISMATCH);
});

test("4F-2a: PERMISSION_DENIED → PERSISTENCE_PERMISSION_DENIED", () => {
  assert.equal(toPersistenceError({ code: "42501" }).code, ErrorCode.PERSISTENCE_PERMISSION_DENIED);
});

test("4F-2a: CONFLICT → PERSISTENCE_CONFLICT", () => {
  assert.equal(toPersistenceError({ code: "23505" }).code, ErrorCode.PERSISTENCE_CONFLICT);
});

test("4F-2a: décision B — NOT_FOUND, VALIDATION_FAILED et UNKNOWN → PERSISTENCE_FAILED", () => {
  for (const err of [{ code: "PGRST116" }, { code: "22P02" }, { code: "XYZ" }, {}]) {
    const mapped = toPersistenceError(err);
    assert.ok(mapped instanceof PersistenceError);
    assert.equal(mapped.code, ErrorCode.PERSISTENCE_FAILED);
  }
});

// ═══════════════════════════════════════════════════════════════
// Sanitisation des metadata (aucun texte backend copié)
// ═══════════════════════════════════════════════════════════════

test("4F-2a: classification et metadata ne copient jamais le texte backend", () => {
  const privateDetail = "private backend credential must never be copied";
  const backendError = Object.assign(new Error(privateDetail), {
    code: "42P01",
    details: privateDetail,
    hint: privateDetail,
  });
  const classification = classifySupabaseError(backendError);
  const mapped = toPersistenceError(backendError, { operation: "write", resource: "guild_config" });

  assert.equal(JSON.stringify(classification).includes(privateDetail), false);
  assert.equal(JSON.stringify(mapped.metadata).includes(privateDetail), false);
  assert.equal(mapped.code, ErrorCode.PERSISTENCE_SCHEMA_MISMATCH);
  assert.equal(mapped.metadata.classification, SupabaseErrorCategory.SCHEMA_MISMATCH);
  assert.equal(mapped.metadata.source, "supabase");
});

test("4F-2a: retryable est propagé pour les erreurs réseau uniquement", () => {
  const network = toPersistenceError({ code: "ECONNRESET" });
  assert.equal(network.retryable, true);
  const conflict = toPersistenceError({ code: "23505" });
  assert.equal(conflict.retryable, false);
});
