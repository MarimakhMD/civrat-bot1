// ═══════════════════════════════════════════════════
// EVENT: guildMemberRemove - Goodbye, Kick Detection, Invite Decrement
// ═══════════════════════════════════════════════════
// FIX: Original had 2 separate listeners. Now merged.

const guildConfigService = require("../services/guildConfig");
const inviteService = require("../services/inviteService");
const { fetchAuditLog } = require("../utils/auditLogCache");
const logger = require("../utils/logger");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");

module.exports = {
  name: "guildMemberRemove",
  once: false,

  async execute(member) {
    const config = await guildConfigService.getGuildConfig(member.guild.id);
    if (!config) return;

    await require("../runtime/getWelcomeGoodbyeRuntime").getWelcomeGoodbyeRuntime().handleMemberRemoved(member);
    await require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime().handleMemberLeft(member);
    await handleKickDetection(member, config);
    await handleInviteDecrement(member, config);
  },
};

async function handleKickDetection(member, config) {
  if (!config.logs_enabled) return;

  setTimeout(async () => {
    try {
      const entry = await fetchAuditLog(member.guild, 20);
      if (!entry || entry.target.id !== member.id) return;

      await getLogsRuntime().handleModerationEvent({
        guild: member.guild,
        config,
        action: "member_kicked",
        targetId: member.id,
      });
    } catch (error) {
      logger.warn(`Kick log detection failed: ${error.message}`);
    }
  }, 1500);
}

async function handleInviteDecrement(member, config) {
  // Phase 11 : garde alignée sur guildMemberAdd — défaut « activé » (tracking
  // historique inconditionnel), opt-out explicite uniquement.
  // De plus, invitedBy est lu dans le MÊME stockage que l'écriture
  // (inviteService.statsRepository partagé) : la lecture directe du modèle
  // mongoose (jamais alimenté par le service legacy) rendait le décrément
  // inopérant — les classements Invites/Analytics ne décroissaient jamais.
  if (config.invitations_enabled === false) return;
  if (member.user.bot) return;

  try {
    // Discord audit entries can arrive just after guildMemberRemove. Do not count a kick as a voluntary invite departure.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const entry = await fetchAuditLog(member.guild, 20);
    if (entry?.target?.id === member.id) return;
    const userData = await inviteService.getInviteStats(member.id, member.guild.id);
    if (userData?.invitedBy) await inviteService.removeInvite(userData.invitedBy, member.guild.id);
  } catch {}
}
