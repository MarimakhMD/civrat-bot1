// ═══════════════════════════════════════════════════
// EVENT: guildMemberAdd - Welcome, AutoRole, Invites, Anti-Raid
// ═══════════════════════════════════════════════════
// FIX: Original had 3 separate listeners. Now merged into one.

let guildConfigService;
try {
  guildConfigService = require("../services/guildConfig");
} catch {
  guildConfigService = { getGuildConfig: async () => ({}) };
}
const inviteService = require("../services/inviteService");
const logger = require("../utils/logger");

module.exports = {
  name: "guildMemberAdd",
  once: false,

  async execute(member) {
    const config = await guildConfigService.getGuildConfig(member.guild.id);
    if (!config) return;

    // 1. Auto Role
    await require("../modules/autorole/runtime/getAutoRoleRuntime").getAutoRoleRuntime().handleMemberJoined(member);
    // 2. Welcome Message
    await require("../runtime/getWelcomeGoodbyeRuntime").getWelcomeGoodbyeRuntime().handleMemberAdded(member);
    // 3. Captcha reminder (best effort; DMs can be closed)
    await require("../modules/captcha/runtime/getCaptchaRuntime").getCaptchaRuntime().handleMemberJoined(member);
    // 4. Invite Tracking — Phase 11 : respecte le toggle /settings Invites.
    //    Comportement historique préservé par défaut : la clé absente (guilde
    //    jamais configurée) laisse le tracking actif ; seul un opt-out explicite
    //    (invitations_enabled === false) le désactive (attribution ET log).
    const invitesEnabled = config.invitations_enabled !== false;
    const inviteResult = invitesEnabled ? await handleInviteTracking(member, config) : null;
    if (invitesEnabled) await handleInviteJoinLog(member, config, inviteResult);
    // 4. Join Log
    await require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime().handleMemberJoined(member);
    // 5. Security Center (modern Foundation → Runtime → Transport/Logs, no legacy securityService)
    try {
      await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleMemberJoined(member);
    } catch {}
    // 6. Analytics (track member, isolated, never break)
    try {
      await require("../modules/analytics/runtime/getAnalyticsRuntime").getAnalyticsRuntime().trackMember(member);
    } catch {}
  },

  // Phase 1 (C3) : export additionnel, strictement additif. `loadEvents`
  // (index.js) n'exige que `name` et `execute`, tous deux inchangés ; cet
  // export ouvre une couture de test sur le chemin réel
  // guildMemberAdd → InviteService → statsRepository, qui n'était couvert
  // par aucun test et a laissé passer le bug `result.inviter.id`.
  handleInviteTracking,
};

async function handleInviteTracking(member, config) {
  if (member.user.bot) return null;

  try {
    if (!inviteService.hasCachedGuild(member.guild.id)) {
      // First join after a restart cannot be attributed reliably; prime cache for subsequent joins.
      await inviteService.refreshGuildInvites(member.guild);
      return null;
    }
    const newInvites = await member.guild.invites.fetch().catch(() => null);
    // B2 : findUsedInvite recache cet instantané quelle que soit sa décision.
    const result = inviteService.findUsedInvite(member.guild.id, newInvites);

    if (result?.inviter) {
      // B2 — self-invite refusée. Ni findUsedInvite ni l'ancien chemin ne le
      // contrôlaient : un membre pouvait être crédité de sa propre arrivée.
      // Rien n'est persisté et aucune attribution n'est remontée : il n'y a pas
      // d'inviteur réel à créditer.
      if (result.inviter === member.id) return null;

      // B2 — UNE seule écriture. Le lien invité → inviteur porte aussi le
      // compteur, qui est dérivé par COUNT(*) et non stocké.
      //
      // L'ancienne paire addInvite() + setInvitedBy() était DEUX écritures
      // séparées : une panne entre les deux laissait un compteur crédité sans
      // lien, et le décrément au départ devenait définitivement impossible.
      // (Phase 1 / C3 : `inviter` est un IDENTIFIANT, pas un objet — l'ancienne
      // lecture `result.inviter.id` valait undefined et créditait la clé
      // "<guildId>:undefined".)
      await inviteService.attributeInvite({
        guildId: member.guild.id,
        invitedId: member.id,
        inviterId: result.inviter,
        inviteCode: result.code || null,
      });
    }

    return result;
  } catch (err) {
    logger.error(`Invite tracking failed for ${member.user.tag}:`, err.message);
    return null;
  }
}


async function handleInviteJoinLog(member, config, inviteResult) {
  if (!inviteResult?.inviter) return;
  await require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime().handleInviteEvent({
    guild: member.guild, config, action: "invite_used", inviteCode: inviteResult.code,
  });
}
