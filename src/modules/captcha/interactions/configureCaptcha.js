"use strict";

const { CaptchaConfigKey: Key, CaptchaComponentId: Id, CAPTCHA_DURATION_PRESETS, CAPTCHA_LIMITS_PRESETS, CAPTCHA_FORCE_EXISTING_MAX_MEMBERS } = require("../configuration/captchaConstants");
const { captchaView, captchaAdvancedView } = require("./captchaViews");
const { DiscordCaptchaTransport } = require("../../../adapters/discord/DiscordCaptchaTransport");
const { CaptchaProvisioningService } = require("../services/CaptchaProvisioningService");
const logger = require("../../../utils/logger");

async function update(context, updates, render = captchaView) {
  const config = await context.service.update(context.guildId, updates);
  await context.envelope.transport.update({ view: render({ t: context.t, config }) });
  return config;
}

async function toggleCaptcha(context) {
  const config = await context.service.read(context.guildId);
  return update(context, { [Key.ENABLED]: !config[Key.ENABLED] });
}

// Réinitialisation complète de la configuration Captcha du serveur
// (réglages de session P-CAPT L1 inclus : retour aux défauts NORMAL).
async function resetCaptcha(context) {
  const config = await context.service.update(context.guildId, {
    [Key.ENABLED]: false,
    [Key.CHANNEL_ID]: null,
    [Key.ROLE_ID]: null,
    [Key.EXPIRY_MINUTES]: null,
    [Key.ATTEMPTS]: null,
    [Key.COOLDOWN_SECONDS]: null,
    // P-CAPT L2 — reset complet.
    [Key.UNVERIFIED_ROLE_ID]: null,
    [Key.FORCE_EXISTING]: false,
    [Key.PANEL_CHANNEL_ID]: null,
    [Key.PANEL_MESSAGE_ID]: null,
  });
  const view = captchaView({ t: context.t, config });
  view.content = `${context.t("captcha.resetDone")}\n${view.content}`;
  await context.envelope.transport.update({ view });
  return config;
}

// Sélection du salon ou du rôle. En environnement réel (guild présente), le
// choix est validé AVANT la sauvegarde : salon textuel + permissions du bot
// (voir/envoyer), rôle existant + attribuable (hiérarchie). En cas d'échec,
// un message clair est affiché et la valeur n'est PAS enregistrée. Hors-ligne
// (tests), la validation est ignorée.
async function selectCaptcha(context) {
  const key = context.envelope.customId === Id.CHANNEL ? Key.CHANNEL_ID : Key.ROLE_ID;
  const value = context.envelope.values?.[0] || null;
  const guild = context.envelope.discordMember?.guild || null;

  if (guild && value) {
    const transport = new DiscordCaptchaTransport({ guild });
    const check = key === Key.CHANNEL_ID
      ? await transport.validateChannel(value)
      : await transport.validateRole(value);
    if (!check.ok) {
      await context.envelope.transport.reply({
        view: { title: context.t("captcha.title"), content: context.t(check.reason), components: [] },
        ephemeral: true,
      });
      return null;
    }
  }

  return update(context, { [key]: value });
}

// P-CAPT L1 — durée d'expiration (whitelist de presets, aucun nombre libre).
async function selectDuration(context) {
  const value = Number(context.envelope.values?.[0]);
  if (!CAPTCHA_DURATION_PRESETS.includes(value)) return null;
  return update(context, { [Key.EXPIRY_MINUTES]: value }, captchaAdvancedView);
}

// P-CAPT L1 — tentatives + cooldown (whitelist de presets, écriture groupée).
async function selectLimits(context) {
  const raw = context.envelope.values?.[0] || "";
  const preset = CAPTCHA_LIMITS_PRESETS.find((p) => `${p.attempts}/${p.cooldownSeconds}` === raw);
  if (!preset) return null;
  return update(context, { [Key.ATTEMPTS]: preset.attempts, [Key.COOLDOWN_SECONDS]: preset.cooldownSeconds }, captchaAdvancedView);
}

// P-CAPT L2 — rôle non vérifié (obligatoire : jamais vidé depuis le select).
async function selectUnverifiedRole(context) {
  const value = context.envelope.values?.[0] || null;
  if (!value) return null;
  const guild = context.envelope.discordMember?.guild || null;
  if (guild) {
    const transport = new DiscordCaptchaTransport({ guild });
    const check = await transport.validateRole(value);
    if (!check.ok) {
      await context.envelope.transport.reply({
        view: { title: context.t("captcha.title"), content: context.t(check.reason), components: [] },
        ephemeral: true,
      });
      return null;
    }
  }
  return update(context, { [Key.UNVERIFIED_ROLE_ID]: value });
}

/**
 * P-CAPT L2 — force-existing (opt-in, désactivé par défaut).
 *  • OFF → ON : active la clé PUIS applique le rôle non vérifié aux humains
 *    concernés — opération BORNÉE (plafond unique par exécution, best-effort
 *    par membre, jamais de boucle), avec résumé éphémère + log ;
 *  • ON → OFF : désactive simplement, aucune exécution.
 * Aucun bot, aucune sanction, aucun autre membre touché qu'un ajout de rôle.
 */
async function toggleForceExisting(context) {
  const config = await context.service.read(context.guildId);
  const wasEnabled = Boolean(config[Key.FORCE_EXISTING]);
  const guild = context.envelope.discordMember?.guild || null;

  if (!config[Key.ENABLED]) {
    await context.envelope.transport.reply({
      view: { title: context.t("captcha.title"), content: context.t("captcha.forceRequiresEnabled"), components: [] },
      ephemeral: true,
    });
    return null;
  }

  if (wasEnabled) {
    await context.service.update(context.guildId, { [Key.FORCE_EXISTING]: false });
    await context.envelope.transport.reply({
      view: { title: context.t("captcha.title"), content: context.t("captcha.forceDisabled"), components: [] },
      ephemeral: true,
    });
    return null;
  }

  if (!guild) return null;

  // La clé passe à ON uniquement si l'exécution peut démarrer.
  const transport = new DiscordCaptchaTransport({ guild });

  // Auto-réparation préalable : le rôle non vérifié est obligatoire.
  const provisioning = new CaptchaProvisioningService({ configService: context.service, transport });
  const provision = await provisioning.ensure(context.guildId, { force: true });
  const freshConfig = provision.config || config;
  if (provision.failed.some((f) => f.element === "unverifiedRole")) {
    const failure = provision.failed.find((f) => f.element === "unverifiedRole");
    await context.envelope.transport.reply({
      view: { title: context.t("captcha.title"), content: `${context.t("captcha.forceProvisionFailed")} — ${failure.code || ""} ${failure.error || ""}`.trim(), components: [] },
      ephemeral: true,
    });
    return null;
  }
  const unverifiedId = freshConfig?.[Key.UNVERIFIED_ROLE_ID] || null;
  if (!unverifiedId) {
    await context.envelope.transport.reply({
      view: { title: context.t("captcha.title"), content: context.t("captcha.forceRoleMissing"), components: [] },
      ephemeral: true,
    });
    return null;
  }

  let members;
  try {
    members = await transport.fetchMembers(CAPTCHA_FORCE_EXISTING_MAX_MEMBERS);
  } catch (error) {
    await context.envelope.transport.reply({
      view: { title: context.t("captcha.title"), content: `${context.t("captcha.forceMembersFetchFailed")} — ${error?.message || ""}`.trim(), components: [] },
      ephemeral: true,
    });
    return null;
  }

  const stats = { processed: 0, applied: 0, bots: 0, alreadyVerified: 0, alreadyUnverified: 0, failed: 0, truncated: false };
  const verifiedId = freshConfig?.[Key.ROLE_ID] || null;
  const wrap = (m) => transport.wrapMember(m);
  for (const m of members) {
    stats.processed += 1;
    if (m?.user?.bot) { stats.bots += 1; continue; }
    const roleIds = wrap(m).roleIds;
    if (verifiedId && roleIds.includes(verifiedId)) { stats.alreadyVerified += 1; continue; }
    if (roleIds.includes(unverifiedId)) { stats.alreadyUnverified += 1; continue; }
    try {
      await transport.assignRole(m, { id: unverifiedId });
      stats.applied += 1;
    } catch {
      stats.failed += 1;
    }
  }

  await context.service.update(context.guildId, { [Key.FORCE_EXISTING]: true });
  logger.info("Captcha force-existing executed", { event: "captcha_force_existing", guildId: context.guildId, actorId: context.userId, ...stats });

  await context.envelope.transport.reply({
    view: { title: context.t("captcha.title"), content: context.t("captcha.forceSummary", stats), components: [] },
    ephemeral: true,
  });
  return { updated: true, stats };
}

module.exports = { toggleCaptcha, selectCaptcha, resetCaptcha, selectDuration, selectLimits, selectUnverifiedRole, toggleForceExisting };
