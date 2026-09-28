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
      // P5 — comparaison LOCALE de la position (jamais ajoutée à roleChanges :
      // l'affichage des logs de rôle reste strictement inchangé).
      const positionChanged = Boolean(oldRole && newRole) && oldRole.position !== newRole.position;
      // Position-seule : pas de log (aucune clé détectée) mais P5 peut
      // signaler. Changement d'avatar/boost seul → toujours aucune suite
      // (comportement historique conservé).
      if (changes.length === 0 && !positionChanged) return;

      // P2-A / P2-B — résolution UNE SEULE FOIS (type RoleUpdate = 31),
      // partagée entre Logs, P2-B et P5 : jamais de second resolve (l'entrée
      // serait déjà consommée). Un événement position-seul n'alimente que P5 :
      // la résolution n'a lieu que si l'anti-nuke est actif (aucun nouvel
      // appel Audit Log quand seul Logs est actif). Fail-closed : pas de
      // correspondance → null.
      const needsActor = antiNukeOn || (logsOn && changes.length > 0);
      const actor = needsActor
        ? await resolveAuditActor({
          guild: newRole.guild,
          type: AuditLogEvent.RoleUpdate,
          targetId: newRole.id,
        })
        : null;

      // Logs strictement inchangés : une position-seule ne produit toujours
      // pas d'entrée role_updated.
      if (logsOn && changes.length > 0) {
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
      // rôles distincts : alert-only, best-effort. Appel préservé à
      // l'identique : uniquement quand `changes` est non vide (une
      // position-seule n'atteint pas P2-B, comme avant P5).
      if (changes.length > 0) {
        try {
          await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleRolePermsUpdate(newRole, changes, actor);
        } catch (error) {
          // 4F-1 — observabilité : best-effort conservé.
          logger.warn("Security roleUpdate handling failed", { event: "security_role_update_failed", guildId: newRole.guild?.id || null, error: error?.message || String(error) });
        }
      }

      // P5 — rafale de modifications NON liées aux permissions, position
      // comprise (alert-only), best-effort. Appelé UNIQUEMENT si au moins une
      // clé ≠ `permissions` ou si la position a bougé. Même `changes`/`actor`
      // que P2-B : AUCUN nouvel appel Audit Log, Logs et Security restent
      // indépendants.
      if (changes.some((change) => change && change.key !== "permissions") || positionChanged) {
        try {
          await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleRoleContentUpdate(newRole, changes, actor, positionChanged);
        } catch (error) {
          // 4F-1 — observabilité : best-effort conservé.
          logger.warn("Security roleUpdate content handling failed", { event: "security_role_update_content_failed", guildId: newRole.guild?.id || null, error: error?.message || String(error) });
        }
      }
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("roleUpdate handling failed", { event: "role_update_failed", guildId: newRole?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
