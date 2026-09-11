// ═══════════════════════════════════════════════════
// EVENT: guildMemberRemove - Goodbye, Kick Detection, Invite Decrement
// ═══════════════════════════════════════════════════
// FIX: Original had 2 separate listeners. Now merged.

const guildConfigService = require("../services/guildConfig");
const inviteService = require("../services/inviteService");
const { AuditLogEvent } = require("discord.js");
const { fetchAuditLog } = require("../utils/auditLogCache");
const { resolveAuditActor } = require("../utils/auditLogActor");
const { memberLabel } = require("../modules/logs/services/logLabels");
const logger = require("../utils/logger");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");

module.exports = {
  name: "guildMemberRemove",
  once: false,

  async execute(member) {
    const config = await guildConfigService.getGuildConfig(member.guild.id);
    if (!config) return;

    // Log de départ : tenté en PREMIER et isolé. Un membre partiel (user null)
    // ou un échec du goodbye ne doit jamais empêcher l'émission de ce log.
    try {
      await require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime().handleMemberLeft(member);
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

    await handleKickDetection(member, config);
    await handleInviteDecrement(member, config);
  },
};

async function handleKickDetection(member, config) {
  if (!config.logs_enabled) return;

  setTimeout(async () => {
    try {
      // P1b — résolution stricte : exécutant/raison récupérés uniquement si
      // l'entrée d'audit vise bien ce membre.
      const actor = await resolveAuditActor({ guild: member.guild, type: AuditLogEvent.MemberKick, targetId: member.id });

      await getLogsRuntime().handleModerationEvent({
        guild: member.guild,
        config,
        action: "member_kicked",
        targetId: member.id,
        target: memberLabel(member),
        reason: actor.reason,
        moderator: actor.executor,
        moderatorId: actor.executorId,
      });
    } catch (error) {
      logger.warn(`Kick log detection failed: ${error.message}`);
    }
  }, 1500);
}

async function handleInviteDecrement(member, config) {
  // Phase 11 : garde alignée sur guildMemberAdd — défaut « activé » (tracking
  // historique inconditionnel), opt-out explicite uniquement.
  if (config.invitations_enabled === false) return;
  // Membre partiel : `member.user` vaut null au départ, ne pas planter.
  if (member.user?.bot) return;

  try {
    // Discord audit entries can arrive just after guildMemberRemove. Do not count a kick as a voluntary invite departure.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const entry = await fetchAuditLog(member.guild, 20);
    if (entry?.target?.id === member.id) return;
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
    await inviteService.revokeInvite(member.guild.id, member.id);
  } catch (error) {
    // 4F-1 — observabilité : best-effort conservé.
    logger.warn("Invite decrement failed", { event: "invite_decrement_failed", guildId: member?.guild?.id || null, error: error?.message || String(error) });
  }
}
