"use strict";

/**
 * Contract for the future PostgreSQL-backed CIVRAT owner authority.
 * Implementations are injected; the core never accesses persistence directly.
 */
class CivratOwnerProvider {
  async isOwner(_userId) {
    throw new Error("CivratOwnerProvider.isOwner must be implemented.");
  }
}

module.exports = { CivratOwnerProvider };
