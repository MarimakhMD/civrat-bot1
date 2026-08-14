"use strict";

/**
 * Audit opérationnel des actions Admin — append-only.
 * Ne contient JAMAIS de secret : acteur, guilde, action, ancienne/nouvelle
 * valeur et raison (jamais de Master/Transfer/Recovery Code, token, SMTP).
 */
class AdminAuditRepository {
  async append(_entry) {
    throw new Error("AdminAuditRepository.append must be implemented.");
  }

  async list(_options) {
    throw new Error("AdminAuditRepository.list must be implemented.");
  }

  async count(_options) {
    throw new Error("AdminAuditRepository.count must be implemented.");
  }
}

module.exports = { AdminAuditRepository };
