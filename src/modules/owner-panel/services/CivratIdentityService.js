"use strict";

const { OwnerPanelPolicy } = require("../configuration/ownerPanelConstants");

// P20 — autorité d'identité CIVRAT : Owner CIVRAT unique + liste des Admins
// CIVRAT.
//
// Distinctions fondamentales :
//  - Owner CIVRAT : propriétaire du bot (≠ Discord Server Owner) ; initial
//    lu depuis CIVRAT_OWNER_ID (env hosting), puis depuis la persistance une
//    fois un transfert effectué (la persistance prime : un transfert doit
//    survivre aux redémarrages) ;
//  - Admin CIVRAT : membre de la liste gérée par le Owner (le Owner N'EST PAS
//    un admin) ;
//  - simple membre Discord : ni l'un ni l'autre.
//
// Persistance : repository injecté (PostgreSQL via Supabase — couture
// documentée). Sans repository (offline / clés absentes) : lecture repliée
// sur l'env (Owner initial uniquement, admins = aucun) et TOUTES les
// mutations sont refusées (fail-closed, code PERSISTENCE_UNAVAILABLE).
//
// Garanties : aucun secret ici (uniquement des IDs Discord) ; les journaux
// sont des événements génériques sans valeur sensible ; la règle « Owner
// only » est re-vérifiée ici en défense en profondeur (la route la vérifie
// déjà via PermissionName.CIVRAT_OWNER).

class CivratIdentityService {
  constructor({ repository = null, env, logger = null, elevation = null }) {
    this.repository = repository; // null => offline : lecture env, mutations refusées
    this.env = env; // { civratOwnerId: () => string|null } — lecture live, jamais figée
    // P20.1 — élévations Recovery injectées ({ isActive, consume }) ; null =>
    // le canal de transfert par récupération est indisponible (fail-closed).
    this.elevation = elevation;
    this.logger = logger;
  }

  log(event, details = {}) {
    this.logger?.info?.("owner_panel_event", { event, ...details });
  }

  refuse(code, details = {}) {
    this.log("owner_panel_refused", { reason: code, ...details });
    return { ok: false, code };
  }

  async getOwnerId() {
    if (this.repository) {
      const stored = await this.repository.readOwnerId();
      if (stored) return stored; // transfert persisté => prime sur l'env
    }
    return this.env.civratOwnerId() || null; // Owner initial (hosting)
  }

  async listAdminIds() {
    if (!this.repository) return [];
    return this.repository.readAdminIds();
  }

  async isOwner(userId) {
    return Boolean(userId) && (await this.getOwnerId()) === userId;
  }

  async isAdmin(userId) {
    return Boolean(userId) && (await this.listAdminIds()).includes(userId);
  }

  async isOwnerOrAdmin(userId) {
    return (await this.isOwner(userId)) || (await this.isAdmin(userId));
  }

  async addAdmin({ actorId, targetId }) {
    if (!(await this.isOwner(actorId))) return this.refuse("OWNER_ONLY");
    if (!isDiscordId(targetId)) return this.refuse("INVALID_TARGET_ID");
    if (await this.isOwner(targetId)) return this.refuse("TARGET_IS_OWNER");
    if (await this.isAdmin(targetId)) return this.refuse("TARGET_ALREADY_ADMIN");
    if (!this.repository) return this.refuse("PERSISTENCE_UNAVAILABLE");
    await this.repository.addAdmin(targetId);
    this.log("admin_added", { actorId });
    return { ok: true, code: "ADMIN_ADDED" };
  }

  async removeAdmin({ actorId, targetId }) {
    if (!(await this.isOwner(actorId))) return this.refuse("OWNER_ONLY");
    if (!isDiscordId(targetId)) return this.refuse("INVALID_TARGET_ID");
    if (!(await this.isAdmin(targetId))) return this.refuse("TARGET_NOT_ADMIN");
    if (!this.repository) return this.refuse("PERSISTENCE_UNAVAILABLE");
    await this.repository.removeAdmin(targetId);
    this.log("admin_removed", { actorId });
    return { ok: true, code: "ADMIN_REMOVED" };
  }

  // Mutation permanente la plus sensible : Owner actuel uniquement (le code
  // OWNER_TRANSFER_CODE est vérifié en amont, route + service).
  async transferOwnership({ actorId, newOwnerId }) {
    if (!(await this.isOwner(actorId))) return this.refuse("OWNER_ONLY");
    if (!isDiscordId(newOwnerId)) return this.refuse("INVALID_TARGET_ID");
    const currentOwnerId = await this.getOwnerId();
    if (newOwnerId === currentOwnerId) return this.refuse("TARGET_ALREADY_OWNER");
    if (!this.repository) return this.refuse("PERSISTENCE_UNAVAILABLE");
    // Effets atomiques côté service : le nouveau Owner devient l'unique Owner
    // (sorti de la liste des admins s'il y était) ; l'ancien Owner perd
    // immédiatement son statut (non rétrogradé admin).
    await this.repository.transferOwnership({ newOwnerId, previousOwnerId: currentOwnerId });
    this.log("ownership_transferred", { actorId });
    return { ok: true, code: "OWNERSHIP_TRANSFERRED" };
  }

  // P20.1 — transfert par RÉCUPÉRATION : canal strictement réservé à un
  // utilisateur dont l'ÉLÉVATION Recovery est encore active. Jamais un simple
  // Admin, jamais une promotion CIVRAT_OWNER préalable : l'élévation n'est
  // qu'un PRÉ-REQUIS à cette seule opération. La mutation persistée est
  // EXACTEMENT celle du transfert normal (même repository, mêmes validations,
  // l'env ne peut plus restaurer l'ancien Owner). Au succès, l'élévation est
  // CONSOMMÉE : un second transfert avec la même élévation est impossible.
  async transferOwnershipViaRecovery({ actorId, newOwnerId }) {
    if (!this.elevation || !(await this.elevation.isActive(actorId))) {
      return this.refuse("RECOVERY_ELEVATION_REQUIRED");
    }
    if (!isDiscordId(newOwnerId)) return this.refuse("INVALID_TARGET_ID");
    const currentOwnerId = await this.getOwnerId();
    if (newOwnerId === currentOwnerId) return this.refuse("TARGET_ALREADY_OWNER");
    if (!this.repository) return this.refuse("PERSISTENCE_UNAVAILABLE");
    await this.repository.transferOwnership({ newOwnerId, previousOwnerId: currentOwnerId });
    this.elevation.consume(actorId); // une élévation = un seul transfert
    this.log("ownership_transferred_via_recovery", { actorId });
    return { ok: true, code: "OWNERSHIP_TRANSFERRED" };
  }
}

function isDiscordId(value) {
  return typeof value === "string" && OwnerPanelPolicy.DISCORD_ID_PATTERN.test(value.trim());
}

module.exports = { CivratIdentityService, isDiscordId };
