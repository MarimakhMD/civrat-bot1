"use strict";

const { OwnerPanelStateStore } = require("../services/OwnerPanelStateStore");
const { CivratIdentityService } = require("../services/CivratIdentityService");
const { OwnerPanelService } = require("../services/OwnerPanelService");
const { SupabaseCivratIdentityRepository } = require("../persistence/SupabaseCivratIdentityRepository");
const { getRecoveryRuntime } = require("../../recovery/runtime/getRecoveryRuntime");

// P20 — runtime partagé du Owner Panel (pattern getTicketPanelRuntime /
// getRecoveryRuntime : singleton paresseux). L'état volatil (sessions,
// verrouillages, confirmations) est commun à toutes les interactions du
// processus ; un redémarrage l'efface (fail-closed, testé).
//
// - Persistance : le client Supabase partagé (src/config/database) ; s'il est
//   absent (offline / clés manquantes), repository = null => lecture repliée
//   sur l'env et mutations refusées (fail-closed, jamais de crash).
// - Secrets : lus À LA DEMANDE dans process.env (jamais copiés, jamais
//   loggés) — une rotation côté hosting ne demande qu'un redémarrage.
// - Lien Recovery : hasRecoveryElevation expose l'élévation temporaire issue
//   d'un Recovery validé (OUVERTURE du panel uniquement ; jamais une
//   promotion Owner — le transfert reste Owner-only + OWNER_TRANSFER_CODE).
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
    });
    const panel = new OwnerPanelService({ state, env });
    runtime = Object.freeze({
      identity,
      panel,
      state,
      hasRecoveryElevation: (userId) => getRecoveryRuntime().hasActiveElevation(userId),
    });
  }
  return runtime;
}

module.exports = { getOwnerPanelRuntime };
