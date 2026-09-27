const { AuditLogEvent } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { channelChanges, formatChanges, overwriteDiff } = require("../modules/logs/services/logDiffs");
const { resolveAuditActorSequence, isOverwriteChange } = require("../utils/auditLogActor");
const logger = require("../utils/logger");

module.exports = {
  name: "channelUpdate",
  once: false,
  async execute(oldChannel, newChannel) {
    try {
      if (!newChannel.guild) return;

      // PHASE 1 — nom, description, permissions, position, slowmode, NSFW,
      // catégorie… : tous les changements réellement détectés, et uniquement
      // ceux-là. La config est lue AVANT l'Audit Log : si ni les Logs ni
      // l'anti-nuke ne sont actifs, aucune requête API n'est émise.
      const config = await guildConfigService.getGuildConfig(newChannel.guild.id);
      const logsOn = Boolean(config?.logs_enabled);
      const antiNukeOn = Boolean(config?.security_anti_nuke);
      if (!logsOn && !antiNukeOn) return;

      const changes = channelChanges(oldChannel, newChannel);
      if (changes.length === 0) return;

      // P2-B — TYPES D'AUDIT PERTINENTS, essayés dans l'ordre, arrêt dès la
      // première correspondance fiable :
      //  • sans changement d'overwrites → cas normal ChannelUpdate (11) seul ;
      //  • avec la clé `permissions` → Discord journalise CHANNEL_OVERWRITE_*
      //    (13/14/15), JAMAIS un overwrite pur sous le type 11 : les types sont
      //    ordonnés par évidence (ajout→13, modif→14, retrait→15), puis 11 en
      //    secours (événement mixte overwrite + autres champs).
      // Cibles candidates : le salon d'abord (hypothèse PROBABLE target_id =
      // channel.id), puis les overwrites réellement touchés (hypothèse
      // « affected entity »). Fail-closed : aucune correspondance → acteur
      // null, jamais inventé.
      const hasPermChange = changes.some((change) => change && change.key === "permissions");
      let types = [{ type: AuditLogEvent.ChannelUpdate }];
      let targetIds = [newChannel.id];
      if (hasPermChange) {
        const diff = overwriteDiff(oldChannel, newChannel);
        const evidence = [];
        if (diff.added.length > 0) evidence.push({ type: AuditLogEvent.ChannelOverwriteCreate, changeFilter: isOverwriteChange });
        if (diff.modified.length > 0) evidence.push({ type: AuditLogEvent.ChannelOverwriteUpdate, changeFilter: isOverwriteChange });
        if (diff.removed.length > 0) evidence.push({ type: AuditLogEvent.ChannelOverwriteDelete, changeFilter: isOverwriteChange });
        if (evidence.length === 0) {
          // Preuves non déterminables (caches étranges) : on essaie les trois
          // types d'overwrite, puis le cas normal.
          evidence.push(
            { type: AuditLogEvent.ChannelOverwriteUpdate, changeFilter: isOverwriteChange },
            { type: AuditLogEvent.ChannelOverwriteCreate, changeFilter: isOverwriteChange },
            { type: AuditLogEvent.ChannelOverwriteDelete, changeFilter: isOverwriteChange },
          );
        }
        types = [...evidence, { type: AuditLogEvent.ChannelUpdate }];
        targetIds = [newChannel.id, ...diff.added, ...diff.modified, ...diff.removed];
      }

      // P2-B — résolution UNE SEULE FOIS, partagée entre Logs et Security
      // (pattern P2-A : jamais deux resolves — l'entrée serait consommée).
      const actor = await resolveAuditActorSequence({ guild: newChannel.guild, types, targetIds });

      if (logsOn) {
        const { before, after, permissions } = formatChanges(changes, config);
        await getLogsRuntime().handleChannelEvent({
          channel: newChannel,
          config,
          action: "channel_updated",
          who: actor ? actor.executor : undefined,
          before,
          after,
          permissions,
        });
      }

      // P2-B — compteur de rafale d'overwrites (alert-only), best-effort.
      try {
        await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleChannelPermsUpdate(newChannel, changes, actor);
      } catch (error) {
        // 4F-1 — observabilité : best-effort conservé.
        logger.warn("Security channelUpdate handling failed", { event: "security_channel_update_failed", guildId: newChannel.guild?.id || null, error: error?.message || String(error) });
      }

      // P5 — rafale de modifications NON liées aux permissions (alert-only),
      // best-effort. Appelé UNIQUEMENT si `changes` contient au moins une clé
      // différente de `permissions` (les updates « permissions seules »
      // restent le domaine exclusif de P2-B). Même `changes` et même `actor`
      // que P2-B : AUCUN nouvel appel Audit Log, Logs et Security restent
      // indépendants.
      if (changes.some((change) => change && change.key !== "permissions")) {
        try {
          await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleChannelContentUpdate(newChannel, changes, actor);
        } catch (error) {
          // 4F-1 — observabilité : best-effort conservé.
          logger.warn("Security channelUpdate content handling failed", { event: "security_channel_update_content_failed", guildId: newChannel.guild?.id || null, error: error?.message || String(error) });
        }
      }
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("channelUpdate handling failed", { event: "channel_update_failed", guildId: newChannel?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
