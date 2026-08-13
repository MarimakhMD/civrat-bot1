"use strict";

const { createHash, randomInt, timingSafeEqual } = require("node:crypto");
const { RecoveryPolicy } = require("../configuration/recoveryConstants");

// P20 — double facteur de récupération propriétaire.
//
//   1. requestRecovery : le Master Code (variable d'environnement du
//      hosting, lue à la demande et comparée côté serveur en temps constant)
//      débloque la GÉNÉRATION d'un code temporaire cryptographiquement
//      aléatoire, envoyé à l'adresse de récupération via le mailer injecté.
//   2. verifyRecovery : le code saisi est vérifié (hash SHA-256, temps
//      constant). Usage unique, expiration courte, tentatives bornées,
//      nouvelle demande = ancien code invalidé.
//
// Garanties de secret absolues :
//  - ni le Master Code ni le code temporaire ne sont JAMAIS loggés, stockés
//    en clair ou renvoyés dans une réponse ;
//  - les résultats publics sont des codes génériques côté interface (les
//    codes internes précis servent aux tests et aux logs d'événements, qui ne
//    contiennent jamais aucune valeur sensible) ;
//  - la comparaison se fait sur des digests SHA-256 de taille fixe via
//    crypto.timingSafeEqual (aucune fuite de longueur ni timing oracle).
//
// L'élévation (hasActiveElevation) est la COUTURE qui rattache la récupération
// à l'identité propriétaire. Consommateur V1 UNIQUE et strictement borné
// (décision §8 du brief P20) : elle autorise l'OUVERTURE du Owner Panel
// (`canOpen`), jamais une promotion Owner — le transfert permanent reste
// Owner-only + OWNER_TRANSFER_CODE. Les élévations vivent dans le store
// partagé : sinon chaque instance créée par serviceFactory repartirait avec
// une carte vide et l'élévation serait perdue entre deux interactions.

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest();
}

function safeEqual(left, right) {
  return timingSafeEqual(sha256(left), sha256(right));
}

class RecoveryService {
  constructor({ store, env, mailer, logger = null, now = () => Date.now(), policy = RecoveryPolicy }) {
    this.store = store;
    this.env = env; // { masterCode: () => string|null, recoveryEmail: () => string|null } — lecture live, jamais figée
    this.mailer = mailer; // interface : send({ to, subject, text })
    this.logger = logger;
    this.now = now;
    this.policy = policy;
  }

  log(event, details = {}) {
    // Événements génériques uniquement : jamais de code, d'e-mail ni de secret.
    this.logger?.info?.("recovery_event", { event, ...details });
  }

  async requestRecovery({ guildId, userId, masterCode }) {
    const configured = this.env.masterCode() && this.env.recoveryEmail() && this.mailer;
    if (!configured) {
      this.log("recovery_unavailable", { guildId, userId });
      return { sent: false, code: "RECOVERY_UNAVAILABLE" };
    }
    if (!masterCode || !safeEqual(masterCode, this.env.masterCode())) {
      this.log("recovery_master_refused", { guildId, userId });
      return { sent: false, code: "RECOVERY_MASTER_INVALID" };
    }
    const lastRequest = this.store.getLastRequestAt(userId);
    // lastRequest === 0 signifie « jamais demandé » : aucune limite ne
    // s'applique (indépendant de la valeur absolue de l'horloge).
    if (lastRequest > 0 && this.now() - lastRequest < this.policy.REQUEST_COOLDOWN_MS) {
      // Anti-spam : la demande limitée N'invalide PAS le code en cours
      // (seule une demande aboutie génère un nouveau code).
      this.log("recovery_request_limited", { guildId, userId });
      return { sent: false, code: "RECOVERY_REQUEST_LIMITED" };
    }

    const tempCode = String(randomInt(0, 10 ** this.policy.CODE_LENGTH)).padStart(this.policy.CODE_LENGTH, "0");
    try {
      await this.mailer.send({
        to: this.env.recoveryEmail(),
        subject: "CIVRAT recovery code",
        text: `Your CIVRAT recovery code is: ${tempCode}\nIt expires in ${Math.round(this.policy.CODE_TTL_MS / 60000)} minutes and can be used only once.`,
      });
    } catch (_error) {
      // L'échec d'envoi ne laisse aucun code valide derrière.
      this.store.deleteCode(guildId, userId);
      this.log("recovery_delivery_failed", { guildId, userId });
      return { sent: false, code: "RECOVERY_DELIVERY_FAILED" };
    }

    // Nouvelle demande aboutie => tout ancien code de cet utilisateur (sur
    // cette guilde) est remplacé/invalidé.
    this.store.saveCode(guildId, userId, sha256(tempCode).toString("hex"), this.now() + this.policy.CODE_TTL_MS);
    this.store.markRequest(userId, this.now());
    this.log("recovery_code_sent", { guildId, userId });
    return { sent: true, code: "RECOVERY_CODE_SENT" };
  }

  verifyRecovery({ guildId, userId, code }) {
    const entry = this.store.readCode(guildId, userId);
    if (!entry) return this.refuse("RECOVERY_NO_PENDING", guildId, userId);
    if (this.now() > entry.expiresAt) {
      this.store.deleteCode(guildId, userId);
      return this.refuse("RECOVERY_CODE_EXPIRED", guildId, userId);
    }
    if (entry.attempts >= this.policy.MAX_VERIFY_ATTEMPTS) {
      this.store.deleteCode(guildId, userId);
      return this.refuse("RECOVERY_TOO_MANY_ATTEMPTS", guildId, userId);
    }
    if (!code || typeof code !== "string" || !this.matches(code, entry.hash)) {
      const attempts = this.store.incrementAttempts(guildId, userId);
      if (attempts >= this.policy.MAX_VERIFY_ATTEMPTS) {
        this.store.deleteCode(guildId, userId);
        return this.refuse("RECOVERY_TOO_MANY_ATTEMPTS", guildId, userId);
      }
      return this.refuse("RECOVERY_CODE_INVALID", guildId, userId);
    }
    // Succès : invalidation immédiate (usage unique) + élévation partagée.
    this.store.deleteCode(guildId, userId);
    const expiresAt = this.now() + this.policy.ELEVATION_WINDOW_MS;
    this.store.setElevation(userId, expiresAt);
    this.log("recovery_verified", { guildId, userId });
    return { recovered: true, code: "RECOVERY_VERIFIED", elevationExpiresAt: expiresAt };
  }

  matches(code, storedHashHex) {
    return timingSafeEqual(sha256(code), Buffer.from(storedHashHex, "hex"));
  }

  refuse(code, guildId, userId) {
    this.log("recovery_refused", { guildId, userId, reason: code });
    return { recovered: false, code };
  }

  // Élévation active après une vérification réussie (store partagé — voir
  // l'en-tête pour l'unique consommateur V1 autorisé).
  hasActiveElevation(userId) {
    return this.store.hasActiveElevation(userId, this.now());
  }
}

module.exports = { RecoveryService };
