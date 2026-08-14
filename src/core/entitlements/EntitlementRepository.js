"use strict";

/**
 * Contract for CIVRAT entitlement persistence (the single Premium system).
 * The Admin Panel extends this contract — never a parallel Premium engine.
 * All reads/writes go through a repository implementation (Supabase, or an
 * in-memory double in tests).
 */
class EntitlementRepository {
  async findFeature(_guildId, _feature) {
    throw new Error("EntitlementRepository.findFeature must be implemented.");
  }

  async listFeatures(_guildId) {
    throw new Error("EntitlementRepository.listFeatures must be implemented.");
  }

  async listAll() {
    throw new Error("EntitlementRepository.listAll must be implemented.");
  }

  // Upsert (retrocompatible : only provided columns are written; existing rows
  // keep their untouched columns). status starts_at/ends_at/plan come from the
  // caller — old rows without starts_at/plan stay exploitable (read as null).
  async activate(_record) {
    throw new Error("EntitlementRepository.activate must be implemented.");
  }

  // Non-destructive deactivation : only the status changes, the row is kept
  // (history + re-activation possible, no data loss).
  async setStatus(_guildId, _feature, _status) {
    throw new Error("EntitlementRepository.setStatus must be implemented.");
  }
}

module.exports = { EntitlementRepository };
