"use strict";

/**
 * Contract for CIVRAT entitlement persistence (the single Premium system).
 * Reads stay transport-neutral. Mutation implementations receive the opaque
 * permit issued by PremiumMutationPolicy so protected-guild checks can also be
 * enforced at the persistence boundary.
 */
class EntitlementRepository {
  async findFeature(_guildId, _feature) {
    throw new Error("EntitlementRepository.findFeature must be implemented.");
  }

  async listFeatures(_guildId) {
    throw new Error("EntitlementRepository.listFeatures must be implemented.");
  }

  /**
   * Toutes les lignes de la table.
   *
   * 4D/R1 — renvoie `{ rows, totalRows, truncated }` et NON plus un tableau nu.
   * Une implémentation doit borner sa lecture (pagination + plafond) : PostgREST
   * tronque silencieusement à `db-max-rows`, donc un tableau nu ne peut pas
   * exprimer « j'ai peut-être été coupé ». `truncated` est le seul signal
   * honnête d'une liste incomplète.
   */
  async listAll() {
    throw new Error("EntitlementRepository.listAll must be implemented.");
  }

  async activate(_record, _permit = null) {
    throw new Error("EntitlementRepository.activate must be implemented.");
  }

  async setStatus(_guildId, _feature, _status, _permit = null) {
    throw new Error("EntitlementRepository.setStatus must be implemented.");
  }
}

module.exports = { EntitlementRepository };
