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
