"use strict";

const { createHash, timingSafeEqual } = require("node:crypto");
const { OwnerPanelPolicy } = require("../configuration/ownerPanelConstants");

// P20 — authentification du Owner Panel et gestion des confirmations.
//
//  - authenticate : compare le Master Code saisi à la variable d'env du
//    hosting (lecture live, comparaison en temps constant sur digests
//    SHA-256 de taille fixe). Succès => session courte en mémoire (fail-closed
//    au redémarrage). Échecs : comptés, verrouillage temporaire au-delà du
//    seuil. Le code N'EST JAMAIS loggé, stocké ni renvoyé.
//  - verifyTransferCode : même discipline pour OWNER_TRANSFER_CODE (aucune
//    session créée : le code protège l'action de transfert elle-même).
//    P20.1 — les échecs de Transfer Code alimentent le MÊME compteur que le
//    Master Code (système anti force brute existant réutilisé : verrou au
//    seuil, remise à zéro au succès). Aucun système parallèle.
//  - pending : les actions sensibles (ajout/retrait admin, transfert Owner)
//    exigent une confirmation explicite ; l'action en attente expire vite et
//    est consommée une seule fois (confirm OU cancel).
//
// Toutes les réponses exposées sont des codes génériques : il est impossible
// de distinguer « presque bon » de « totalement faux ».

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest();
}

function safeEqual(left, right) {
  return timingSafeEqual(sha256(left), sha256(right));
}

class OwnerPanelService {
  constructor({ state, env, logger = null, now = () => Date.now(), policy = OwnerPanelPolicy }) {
    this.state = state;
    this.env = env; // { panelMasterCode: () => string|null, transferCode: () => string|null }
    this.logger = logger;
    this.now = now;
    this.policy = policy;
  }

  log(event, details = {}) {
    this.logger?.info?.("owner_panel_event", { event, ...details });
  }

  authenticate(userId) {
    return this.state.hasActiveSession(userId, this.now());
  }

  // code : saisie utilisateur. Retourne { ok, code } — jamais de détail.
  // V1 — la durée de session dépend du rôle : Owner = 24 h, sinon (accès
  // lecture Master Code) = session courte. Les Admins CIVRAT ne passent PAS
  // par ici (accès permanent lié à leur statut, sans code ni session).
  tryAuthenticate(userId, code, { isOwner = false } = {}) {
    const master = this.env.panelMasterCode();
    if (!master) {
      this.log("owner_panel_unavailable", { userId });
      return { ok: false, code: "PANEL_UNAVAILABLE" };
    }
    const failures = this.state.readFailures(userId);
    if (failures.lockedUntil > this.now()) {
      this.log("owner_panel_locked", { userId });
      return { ok: false, code: "PANEL_LOCKED" };
    }
    if (!code || !safeEqual(code, master)) {
      const lockedUntil = failures.count + 1 >= this.policy.MAX_MASTER_FAILURES
        ? this.now() + this.policy.LOCK_TTL_MS
        : 0;
      this.state.registerFailure(userId, lockedUntil);
      this.log("owner_panel_auth_refused", { userId });
      return { ok: false, code: "PANEL_AUTH_REFUSED" };
    }
    this.state.clearFailures(userId);
    const ttl = isOwner ? this.policy.OWNER_SESSION_TTL_MS : this.policy.SESSION_TTL_MS;
    this.state.setSession(userId, this.now() + ttl);
    this.log("owner_panel_authenticated", { userId });
    return { ok: true, code: "PANEL_AUTHENTICATED" };
  }

  verifyTransferCode(userId, code) {
    const expected = this.env.transferCode();
    if (!expected) {
      this.log("owner_transfer_unavailable", { userId });
      return false;
    }
    const failures = this.state.readFailures(userId);
    if (failures.lockedUntil > this.now()) {
      this.log("owner_transfer_locked", { userId });
      return false; // verrou anti force brute PARTAGÉ avec le Master Code
    }
    const ok = Boolean(code) && safeEqual(code, expected);
    if (ok) {
      this.state.clearFailures(userId);
    } else {
      const lockedUntil = failures.count + 1 >= this.policy.MAX_MASTER_FAILURES
        ? this.now() + this.policy.LOCK_TTL_MS
        : 0;
      this.state.registerFailure(userId, lockedUntil);
    }
    this.log(ok ? "owner_transfer_code_accepted" : "owner_transfer_code_refused", { userId });
    return ok;
  }

  setPending(userId, action) {
    this.state.setPending(userId, { ...action, expiresAt: this.now() + this.policy.PENDING_TTL_MS });
  }

  consumePending(userId) {
    return this.state.consumePending(userId, this.now());
  }
}

module.exports = { OwnerPanelService };
