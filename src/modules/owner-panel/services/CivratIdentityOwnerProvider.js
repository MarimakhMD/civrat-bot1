"use strict";

const { CivratOwnerProvider } = require("../../../core/permissions/CivratOwnerProvider");

// P20 — provider concret de la couture `PermissionName.CIVRAT_OWNER` : la
// phase « PostgreSQL Owner Panel » prévue par le core. ADOSSE le service
// d'identité (env + persistance Supabase). Injecté dans PermissionService à
// la composition (createGuildSettingsRuntime).
//
// Fail-closed absolu : toute erreur (persistance injoignable, runtime non
// initialisé) => isOwner false. Jamais de détail d'erreur exposé.
class CivratIdentityOwnerProvider extends CivratOwnerProvider {
  constructor({ identityServiceFactory, logger = null }) {
    super();
    this.identityServiceFactory = identityServiceFactory;
    this.logger = logger;
  }

  async isOwner(userId) {
    try {
      if (!userId) return false;
      return await this.identityServiceFactory().isOwner(userId);
    } catch (_error) {
      this.logger?.warn?.("owner_panel_event", { event: "owner_check_failed" });
      return false;
    }
  }
}

module.exports = { CivratIdentityOwnerProvider };
