const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { roleLabel } = require("../modules/logs/services/logLabels");
const { roleChanges, formatChanges } = require("../modules/logs/services/logDiffs");
const { resolveAuditActor } = require("../utils/auditLogActor");
const guildConfigService = require("../services/guildConfig");
const logger = require("../utils/logger");

module.exports = {
  name: "roleUpdate",
  once: false,
  async execute(oldRole, newRole) {
    try {
      // PHASE 1 — tous les changements réels, pas seulement le renommage.
      // La config est lue AVANT l'Audit Log : si ni les Logs ni l'anti-nuke ne
      // sont actifs, aucune requête API n'est émise.
      const config = await guildConfigService.getGuildConfig(newRole.guild.id);
      const logsOn = Boolean(config?.logs_enabled);
      const antiNukeOn = Boolean(config?.security_anti_nuke);
      if (!logsOn && !antiNukeOn) return;

      const changes = roleChanges(oldRole, newRole);
      if (changes.length === 0) return;

      // P2-A / P2-B — résolution UNE SEULE FOIS (type RoleUpdate = 31),
      // partagée entre Logs et Security : jamais de second resolve (l'entrée
      // serait déjà consommée). Fail-closed : pas de correspondance → null.
      const actor = await resolveAuditActor({
        guild: newRole.guild,
        type: AuditLogEvent.RoleUpdate,
        targetId: newRole.id,
      });

      if (logsOn) {
        const { before, after, permissions } = formatChanges(changes, config);
        await getLogsRuntime().handleRoleEvent({
          guild: newRole.guild,
          config,
          action: "role_updated",
          roleId: newRole.id,
          target: roleLabel(newRole),
          who: actor ? actor.executor : undefined,
          before,
          after,
          permissions,
        });
      }

      // P2-B — signal fort N1 (gain de permission sensible) + rafale de
      // rôles distincts : alert-only, best-effort.
      try {
        await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleRolePermsUpdate(newRole, changes, actor);
      } catch (error) {
        // 4F-1 — observabilité : best-effort conservé.
        logger.warn("Security roleUpdate handling failed", { event: "security_role_update_failed", guildId: newRole.guild?.id || null, error: error?.message || String(error) });
      }
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("roleUpdate handling failed", { event: "role_update_failed", guildId: newRole?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
