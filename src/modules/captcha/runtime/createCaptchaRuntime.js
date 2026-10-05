"use strict";

const { CaptchaConfigService } = require("../services/CaptchaConfigService");
const { CaptchaReminderService } = require("../services/CaptchaReminderService");
const { CaptchaProvisioningService } = require("../services/CaptchaProvisioningService");
const { CaptchaPanelService } = require("../services/CaptchaPanelService");
const { CaptchaPanelDeliveryService } = require("../services/CaptchaPanelDeliveryService");
const { DiscordCaptchaTransport } = require("../../../adapters/discord/DiscordCaptchaTransport");
const { CaptchaConfigKey: Key } = require("../configuration/captchaConstants");
const { I18nService, resolveGuildLocale } = require("../../../core/i18n");
const captchaEn = require("../translations/en.json");
const captchaFr = require("../translations/fr.json");

// Traducteur localisé pour les messages envoyés hors interaction (DM, panneau
// de démarrage) : pas de clés brutes dans les messages envoyés.
const captchaRuntimeI18n = new I18nService({ dictionaries: { en: captchaEn, fr: captchaFr } });
function translatorFor(guild) {
  return captchaRuntimeI18n.forLocale(resolveGuildLocale(guild?.preferredLocale || "fr"));
}

/**
 * P-CAPT L2 — runtime join + réconciliation du panneau au démarrage.
 *
 * Arrivée d'un humain (captcha actif) :
 *  1. auto-réparation bornée : recrée UNIQUEMENT les éléments manquants ;
 *  2. retire le rôle vérifié s'il est présent, applique le rôle non vérifié ;
 *  3. prépare l'accès au panneau (régénère le panneau officiel s'il n'y en a
 *     aucun de persisté) ;
 *  4. DM de statut « non vérifié » (information uniquement, jamais un canal
 *     de vérification parallèle).
 * Bots ignorés, aucune sanction, aucun membre existant traité ici
 * (force-existing reste opt-in, géré dans les réglages).
 */
function createCaptchaRuntime({ guildConfigResolver, transportFactory = null }) {
  const configService = new CaptchaConfigService({ guildConfigResolver });
  const makeTransport = transportFactory || (({ guild, member }) => new DiscordCaptchaTransport({ guild, member }));

  async function handleMemberJoined(member) {
    if (member?.user?.bot) return { sent: false, code: "BOT_MEMBER", details: {} };
    if (!member?.guild?.id) return { sent: false, code: "GUILD_UNAVAILABLE", details: {} };

    let config;
    try {
      config = await configService.read(member.guild.id);
    } catch (error) {
      return { sent: false, code: "CONFIG_UNAVAILABLE", details: { error: error?.message || String(error) } };
    }
    if (!config?.[Key.ENABLED]) return { sent: false, code: "CAPTCHA_DISABLED", details: {} };

    const t = translatorFor(member.guild);
    const transport = makeTransport({ guild: member.guild, member });

    // 1. Auto-réparation (déclencheur : arrivée) — best-effort par élément.
    const provisioning = new CaptchaProvisioningService({ configService, transport });
    let provision = { created: [], intact: [], failed: [], skipped: [] };
    try {
      provision = await provisioning.ensure(member.guild.id);
      if (provision.config) config = provision.config;
    } catch {
      // jamais fatal : le reste du join continue avec la config lue.
    }

    // 2. Rôles : retrait du rôle vérifié, application du rôle non vérifié.
    const roles = { verifiedRemoved: false, unverifiedApplied: false, failures: [] };
    const wrap = transport.wrapMember(member);
    let effectiveRoleIds = wrap.roleIds;
    try {
      const verifiedId = config?.[Key.ROLE_ID] || null;
      if (verifiedId && effectiveRoleIds.includes(verifiedId)) {
        const role = await transport.getRole(verifiedId);
        if (role) {
          await transport.unassignRole(member, role);
          roles.verifiedRemoved = true;
          effectiveRoleIds = effectiveRoleIds.filter((id) => id !== verifiedId);
        }
      }
      const unverifiedId = config?.[Key.UNVERIFIED_ROLE_ID] || null;
      if (unverifiedId && !effectiveRoleIds.includes(unverifiedId)) {
        const role = await transport.getRole(unverifiedId);
        if (role) {
          await transport.assignRole(member, role);
          roles.unverifiedApplied = true;
          effectiveRoleIds = [...effectiveRoleIds, unverifiedId];
        }
      }
    } catch (error) {
      roles.failures.push(error?.message || String(error));
    }

    // 3. Panneau : régénéré seulement si AUCUN panneau officiel persisté.
    let panel = { delivered: false, reason: "captcha.panelPresent", details: {} };
    if (!config?.[Key.PANEL_MESSAGE_ID]) {
      try {
        const delivery = new CaptchaPanelDeliveryService({
          panelService: new CaptchaPanelService({ configService }),
          transport,
          configService,
        });
        panel = await delivery.deliver(member.guild.id, t);
      } catch (error) {
        panel = { delivered: false, reason: "captcha.panelSendFailed", details: { error: error?.message || String(error) } };
      }
    }

    // 4. DM de statut « non vérifié » (best-effort : les DM peuvent être fermés).
    const reminder = new CaptchaReminderService({
      configService: { read: async () => config },
      transport,
    });
    const dm = await reminder.remind({
      guildId: member.guild.id,
      member: { id: member.id, roleIds: effectiveRoleIds, discordMember: member },
      t,
    });

    return { ...dm, roles, panel, provision: { created: provision.created, failed: provision.failed } };
  }

  /** P-CAPT L2 — startup (event ready) : un seul panneau officiel par guilde. */
  async function reconcilePanelsOnStartup(client) {
    const summary = { guilds: 0, delivered: 0, skipped: 0, failed: 0 };
    const guilds = [...(client?.guilds?.cache?.values?.() || [])];
    for (const guild of guilds) {
      summary.guilds += 1;
      try {
        const config = await configService.read(guild.id);
        if (!config?.[Key.ENABLED] || !config?.[Key.CHANNEL_ID] || !config?.[Key.ROLE_ID]) {
          summary.skipped += 1;
          continue;
        }
        const delivery = new CaptchaPanelDeliveryService({
          panelService: new CaptchaPanelService({ configService }),
          transport: makeTransport({ guild }),
          configService,
        });
        const result = await delivery.deliver(guild.id, translatorFor(guild));
        if (result.delivered) summary.delivered += 1;
        else summary.skipped += 1;
      } catch {
        summary.failed += 1;
      }
    }
    return summary;
  }

  return { handleMemberJoined, reconcilePanelsOnStartup };
}

module.exports = { createCaptchaRuntime };
