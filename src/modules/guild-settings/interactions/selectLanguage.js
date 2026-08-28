"use strict";

const { SupportedLocale } = require("../../../core/i18n");
const { settingsHomeView } = require("./settingsView");
const { SettingsComponentId } = require("./settingsComponents");
const { GuildSettingsTranslationKey: Key } = require("../translations/translationKeys");

async function showLanguageMenu(context) {
  return context.envelope.transport.update({
    view: {
      title: context.t(Key.TITLE),
      content: context.t(Key.LANGUAGE_PROMPT),
      components: [{
        type: "select",
        customId: SettingsComponentId.LANGUAGE,
        placeholder: context.t(Key.LANGUAGE_PROMPT),
        options: Object.values(SupportedLocale).map((value) => ({
          value,
          label: context.t(Key.languageName(value)),
        })),
      }],
    },
  });
}

async function selectLanguage(context) {
  const language = context.envelope.values?.[0];
  const config = await context.settings.updateLanguage(context.guildId, language);
  const t = context.i18n.forLocale(config.language);
  const configState = typeof context.settings.getConfigurationState === "function"
    ? await context.settings.getConfigurationState(context.guildId)
    : { config, available: false, found: false, source: "unavailable" };
  const view = settingsHomeView({ t, language: config.language, configState });
  return context.envelope.transport.update({
    view: {
      ...view,
      content: `${t(Key.LANGUAGE_UPDATED, { language: t(Key.languageName(config.language)) })}\n${view.content}`,
    },
  });
}

module.exports = { showLanguageMenu, selectLanguage };
