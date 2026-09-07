"use strict";

const { InMemoryWarningRepository, normalizeReason } = require("../persistence/WarningRepository");

/**
 * B1 — Avertissement d'un membre.
 *
 * ORDRE IMPOSÉ PAR §17 : « l'échec du DM n'annule jamais le warning ».
 *
 *   1. contrôles (guilde, cible, self-warn, bot, hiérarchie, raison)
 *   2. INSERT en base            ← à partir d'ici le warning EXISTE
 *   3. DM au membre              ← son échec ne remet rien en cause
 *   4. retour                    ← le code distingue les trois issues
 *
 * Avant B1, l'ordre était inverse : le DM était le warning. Un membre aux DM
 * fermés faisait échouer `user.send`, le service renvoyait WARN_FAILED, le log
 * était conditionné au succès — et l'avertissement n'existait nulle part.
 *
 * La persistance ne dépend donc JAMAIS du succès du DM, et le DM ne dépend
 * jamais d'autre chose que d'un warning déjà écrit.
 */
class WarningService {
  /**
   * @param {object} [options]
   * @param {object} [options.repository] dépôt de warnings (défaut : InMemory)
   * @param {object} [options.logger]     journal optionnel
   */
  constructor({ repository, logger = null } = {}) {
    this.repository = repository && typeof repository.createWarning === "function"
      ? repository
      : new InMemoryWarningRepository();
    this.logger = logger;
  }

  /**
   * @returns {Promise<{warned:boolean, code:string, targetId?:string, reason?:string|null,
   *   warningId?:number|null, dmSent?:boolean}>}
   */
  async warn({ guildId, actor, targetId, reason = null, transport, t } = {}) {
    // ── 1. Contrôles, tous AVANT toute écriture ──
    if (!guildId || !actor?.id) return { warned: false, code: "WARN_GUILD_MISMATCH" };
    if (!targetId) return { warned: false, code: "WARN_INVALID_TARGET" };

    // B1 — self-warn explicitement interdit. Ni canModerate ni l'ancien service
    // ne le contrôlaient : un modérateur pouvait s'avertir lui-même.
    if (targetId === actor.id) return { warned: false, code: "WARN_SELF_TARGET" };

    // Raison validée avant tout I/O : une raison hors borne est une entrée
    // invalide, pas un avertissement à amputer. Jamais de troncature.
    const normalized = normalizeReason(reason);
    if (!normalized.ok) return { warned: false, code: normalized.code };

    const target = await transport.getMember(targetId);
    if (!target || target.bot) return { warned: false, code: "WARN_INVALID_TARGET" };
    if (!transport.canModerate(target, actor)) return { warned: false, code: "WARN_TARGET_NOT_MODERATABLE" };

    // ── 2. Écriture : le warning existe à partir d'ici ──
    let warning;
    try {
      warning = await this.repository.createWarning({
        guildId,
        userId: targetId,
        moderatorId: actor.id,
        reason: normalized.reason,
      });
    } catch (error) {
      // Aucun DM, aucun succès : un avertissement non enregistré ne doit pas
      // être annoncé comme tel.
      this._warn("Warning persistence failed", {
        guildId,
        targetId,
        code: error?.code || null,
      });
      return { warned: false, code: "WARN_PERSISTENCE_FAILED" };
    }

    // ── 3. DM : son échec n'annule JAMAIS le warning déjà écrit ──
    let dmSent = true;
    try {
      await transport.sendWarning(target, { reason: normalized.reason, actor, t });
    } catch (error) {
      dmSent = false;
      this._warn("Warning recorded but DM delivery failed", {
        guildId,
        targetId,
        warningId: warning?.id ?? null,
        message: error?.message,
      });
    }

    // ── 4. Retour : les deux issues « warning écrit » restent un succès ──
    return {
      warned: true,
      code: dmSent ? "WARN_SUCCESS" : "WARN_SUCCESS_DM_FAILED",
      targetId,
      reason: normalized.reason,
      warningId: warning?.id ?? null,
      dmSent,
    };
  }

  _warn(message, details) {
    try {
      this.logger?.warn?.(message, details);
    } catch {
      /* la journalisation ne doit jamais casser un avertissement */
    }
  }
}

module.exports = { WarningService };
