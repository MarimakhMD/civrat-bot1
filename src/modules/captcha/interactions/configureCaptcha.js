"use strict";

const { CaptchaConfigKey: Key, CaptchaComponentId: Id } = require("../configuration/captchaConstants");
const { captchaView } = require("./captchaViews");
const { DiscordCaptchaTransport } = require("../../../adapters/discord/DiscordCaptchaTransport");

async function update(context, updates) {
  const config = await context.service.update(context.guildId, updates);
  await context.envelope.transport.update({ view: captchaView({ t: context.t, config }) });
  return config;
}

async function toggleCaptcha(context) {
  const config = await context.service.read(context.guildId);
  return update(context, { [Key.ENABLED]: !config[Key.ENABLED] });
}

// Réinitialisation complète de la configuration Captcha du serveur.
async function resetCaptcha(context) {
  const config = await context.service.update(context.guildId, {
    [Key.ENABLED]: false,
    [Key.CHANNEL_ID]: null,
    [Key.ROLE_ID]: null,
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

module.exports = { toggleCaptcha, selectCaptcha, resetCaptcha };
