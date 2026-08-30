"use strict";

const { OwnerPanelStateStore } = require("../services/OwnerPanelStateStore");
const { CivratIdentityService } = require("../services/CivratIdentityService");
const { OwnerPanelService } = require("../services/OwnerPanelService");
const { SupabaseCivratIdentityRepository } = require("../persistence/SupabaseCivratIdentityRepository");
const { getRecoveryRuntime } = require("../../recovery/runtime/getRecoveryRuntime");
const { PremiumMutationAuthority } = require("../../../core/entitlements");
const { getEntitlementService } = require("../../../runtime/getEntitlementService");
const { SupabasePremiumHistoryRepository } = require("../../admin-panel/persistence/SupabasePremiumHistoryRepository");
const { SupabaseAdminAuditRepository } = require("../../admin-panel/persistence/SupabaseAdminAuditRepository");
const { AdminPanelService } = require("../../admin-panel/services/AdminPanelService");
const adminPanelRoutes = require("../../admin-panel/interactions/adminPanelRoutes");

// P20 + Admin Panel — runtime partagé (singleton paresseux). L'état volatil
// (sessions Owner, verrouillages, confirmations, élévations Recovery) est
// commun à toutes les interactions du processus ; un redémarrage l'efface.
//
// L'Admin Panel réutilise le CORE EntitlementService (le SEUL système
// Premium) + deux journaux append-only (historique Premium, audit Admin).
// Offline (supabase absent) : repositories null => lecture repliée et
// mutations refusées (fail-closed, jamais de crash). Aucun secret ici.
let runtime = null;

function getOwnerPanelRuntime() {
  if (!runtime) {
    const { supabase } = require("../../../config/database");
    const repository = supabase ? new SupabaseCivratIdentityRepository({ supabase }) : null;
    const env = {
      civratOwnerId: () => process.env.CIVRAT_OWNER_ID || null,
      panelMasterCode: () => process.env.OWNER_PANEL_MASTER_CODE || null,
      transferCode: () => process.env.OWNER_TRANSFER_CODE || null,
    };
    const state = new OwnerPanelStateStore();
    // P20.1 — canal de récupération : le service d'identité reçoit les
    // élévations Recovery partagées (actif/consommé). Jamais de promotion
    // CIVRAT_OWNER : l'élévation n'ouvre que le canal de transfert dédié.
    const identity = new CivratIdentityService({
      repository,
      env,
      elevation: {
        isActive: (userId) => getRecoveryRuntime().hasActiveElevation(userId),
        consume: (userId) => getRecoveryRuntime().clearElevation(userId),
      },
      // V1 — tout transfert réussi révoque immédiatement la session de
      // l'ancien Owner (aucune session automatique pour le nouveau).
      onOwnershipTransferred: (previousOwnerId) => state.revokeSession(previousOwnerId),
    });
    const panel = new OwnerPanelService({ state, env });

    // Admin Panel opérationnel : le singleton EntitlementService résout en
    // interne ce runtime pour revérifier le véritable Owner + sa session à
    // chaque mutation du serveur technique.
    const entitlementService = getEntitlementService();
    const historyRepository = supabase ? new SupabasePremiumHistoryRepository({ supabase }) : null;
    const auditRepository = supabase ? new SupabaseAdminAuditRepository({ supabase }) : null;
    let analyticsReader = null;
    try {
      analyticsReader = require("../../analytics/runtime/getAnalyticsRuntime").getAnalyticsRuntime()._repository;
    } catch {
      analyticsReader = null;
    }
    const admin = new AdminPanelService({ entitlementService, historyRepository, auditRepository, analyticsReader });

    runtime = Object.freeze({
      identity,
      panel,
      state,
      admin,
      hasRecoveryElevation: (userId) => getRecoveryRuntime().hasActiveElevation(userId),
      getPremiumMutationAuthority: async (actorId) => (
        await panel.authorizePremiumMutation({ actorId, identityService: identity })
          ? PremiumMutationAuthority.OWNER
          : PremiumMutationAuthority.ADMIN
      ),
      adminPanel: { openDashboard: (context) => adminPanelRoutes.openDashboard(context, runtime) },
    });
  }
  return runtime;
}

module.exports = { getOwnerPanelRuntime };
