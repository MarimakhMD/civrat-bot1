"use strict";

const { SettingsComponentId, SettingsAction } = require("./settingsComponents");
const { GuildSettingsTranslationKey: Key } = require("../translations/translationKeys");

function settingsView(t, language, sections = []) {
  const components = [
    {
      type: "button",
      customId: SettingsComponentId.LANGUAGE,
      action: SettingsAction.OPEN_LANGUAGE,
      label: t(Key.LANGUAGE_BUTTON),
      style: "primary",
    },
    ...sections.map((section) => typeof section === "function" ? section(t) : section),
  ];

  return {
    title: t(Key.TITLE),
    content: t(Key.CURRENT_LANGUAGE, {
      language: t(Key.languageName(language)),
    }),
    components,
  };
}

async function openSettingsPanel(context) {
  const language = await context.settings.getLanguage(context.guildId);
  await context.envelope.transport.reply({
    view: settingsView(context.t, language, context.settingsSections),
    ephemeral: true,
  });
}

module.exports = { openSettingsPanel, settingsView };
