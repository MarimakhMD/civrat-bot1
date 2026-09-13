// ═══════════════════════════════════════════════════
// EVENT: guildMemberRemove - Goodbye, Kick Detection, Invite Decrement
// ═══════════════════════════════════════════════════
// PHASE 1 — un départ = un seul log, et une expulsion n'est journalisée que si
// l'Audit Log en atteste réellement.
//
// Deux défauts corrigés ici :
//  • l'ancien code émettait `member_kicked` INCONDITIONNELLEMENT, même quand
//    aucune entrée d'audit ne correspondait : chaque départ volontaire
//    produisait donc un log « Membre » + un log « Expulsion » fantôme, sans
//    modérateur ni raison ;
//  • la détection de kick et le décrément d'invitations lisaient chacun l'Audit
//    Log en parallèle (même type, deux requêtes API, deux réponses
//    potentiellement divergentes). Une seule résolution est désormais partagée.

const guildConfigService = require("../services/guildConfig");
const inviteService = require("../services/inviteService");
const { resolveAuditAction, AuditLogEventType } = require("../utils/auditLogActor");
const { memberDisplayLabel, avatarUrl } = require("../modules/logs/services/logLabels");
const logger = require("../utils/logger");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");

/** Délai laissé à Discord pour écrire l'entrée d'audit avant de la lire. */
const AUDIT_SETTLE_DELAY_MS = 1500;

module.exports = {
  name: "guildMemberRemove",
  once: false,

  async execute(member) {
    // Instant de l'événement, capturé AVANT tout `await` : c'est la référence
    // temporelle qui interdit d'attribuer un départ à une expulsion ancienne.
    const occurredAt = Date.now();

    const config = await guildConfigService.getGuildConfig(member.guild.id);
    if (!config) return;

    // Log de départ : tenté en PREMIER et isolé. Un membre partiel (user null)
    // ou un échec du goodbye ne doit jamais empêcher l'émission de ce log.
    try {
      await getLogsRuntime().handleMemberLeft(member);
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("Member leave log failed", { event: "member_leave_log_failed", guildId: member?.guild?.id || null, error: error?.message || String(error) });
    }

    // Goodbye : isolé — un membre partiel (user null) ne doit plus faire
    // planter le traitement (cf. adaptGuildMember désormais null-safe).
    try {
      await require("../runtime/getWelcomeGoodbyeRuntime").getWelcomeGoodbyeRuntime().handleMemberRemoved(member);
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("Goodbye handling failed", { event: "goodbye_failed", guildId: member?.guild?.id || null, error: error?.message || String(error) });
    }

    const wantsLogs = Boolean(config.logs_enabled);
    const wantsInvites = !(config.invitations_enabled === false) && !member.user?.bot;
    if (!wantsLogs && !wantsInvites) return;

    // UNE lecture d'audit pour les deux usages.
    const kick = await handleKickDetection(member, occurredAt, wantsLogs || wantsInvites);

    if (wantsLogs) await logKickIfConfirmed(member, config, kick);
    if (wantsInvites) await handleInviteDecrement(member, kick);
  },
};

/**
 * Résout l'expulsion éventuelle de ce membre, avec les gardes cible +
 * fraîcheur + consommation.
 *
 * `matched === false` signifie « aucune expulsion de CE membre dans la fenêtre
 * de l'événement » : c'est un départ volontaire, ou un ban (qui a son propre
 * log), ou un kick trop ancien pour être attribuable.
 */
async function handleKickDetection(member, occurredAt, enabled) {
  if (!enabled) return { kicked: false, executor: null, executorId: null, reason: null };
  try {
    await new Promise((resolve) => setTimeout(resolve, AUDIT_SETTLE_DELAY_MS));
    const action = await resolveAuditAction({
      guild: member.guild,
      type: AuditLogEventType.MEMBER_KICK,
      targetId: member.id,
      occurredAt,
    });
    return {
      kicked: action.matched,
      executor: action.executor,
      executorId: action.executorId,
      reason: action.reason,
    };
  } catch (error) {
    logger.warn("Kick log detection failed", { event: "kick_detection_failed", guildId: member?.guild?.id || null, memberId: member?.id || null, error: error?.message || String(error) });
    return { kicked: false, executor: null, executorId: null, reason: null };
  }
}

/**
 * N'émet `member_kicked` que si l'expulsion est attestée. Sans cette garde, un
 * départ volontaire produisait un log d'expulsion sans modérateur ni raison.
 */
async function logKickIfConfirmed(member, config, kick) {
  if (!kick.kicked) return;
  try {
    await getLogsRuntime().handleModerationEvent({
      guild: member.guild,
      config,
      action: "member_kicked",
      targetId: member.id,
      target: memberDisplayLabel(member),
      reason: kick.reason,
      moderator: kick.executor,
      moderatorId: kick.executorId,
      avatarUrl: avatarUrl(member),
    });
  } catch (error) {
    logger.warn("Kick log delivery failed", { event: "kick_log_failed", guildId: member?.guild?.id || null, memberId: member?.id || null, error: error?.message || String(error) });
  }
}

async function handleInviteDecrement(member, kick) {
  // B2 — révocation par invited_id, en UNE écriture.
  //
  // L'ancien chemin lisait d'abord invitedBy puis décrémentait l'inviteur.
  // Si invitedBy manquait (interruption entre les deux écritures
  // d'attribution, ou arrivée antérieure à B2), le compteur ne redescendait
  // JAMAIS : la dérive était permanente et invisible.
  //
  // Le compteur étant désormais dérivé des liens actifs, poser revoked_at
  // suffit. Un départ sans lien ne matche aucune ligne et ne fausse donc
  // rien. Idempotent : un second départ ne trouve plus de lien actif. La
  // ligne n'est jamais supprimée.
  //
  // Une expulsion ne doit pas être comptée comme un départ volontaire : la
  // résolution partagée sert de garde, sans second appel Audit Log.
  if (kick.kicked) return;

  try {
    await inviteService.revokeInvite(member.guild.id, member.id);
  } catch (error) {
    // 4F-1 — observabilité : best-effort conservé.
    logger.warn("Invite decrement failed", { event: "invite_decrement_failed", guildId: member?.guild?.id || null, error: error?.message || String(error) });
  }
}
