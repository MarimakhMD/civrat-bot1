"use strict";

const { CaptchaConfigKey: Key, CaptchaComponentId: Id, CAPTCHA_DURATION_PRESETS, CAPTCHA_LIMITS_PRESETS } = require("../configuration/captchaConstants");
const { captchaView, captchaAdvancedView } = require("./captchaViews");
const { DiscordCaptchaTransport } = require("../../../adapters/discord/DiscordCaptchaTransport");

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

module.exports = { toggleCaptcha, selectCaptcha, resetCaptcha, selectDuration, selectLimits };
