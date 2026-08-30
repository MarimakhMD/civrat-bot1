"use strict";

const { settingsHomeView, settingsCategoryView } = require("./settingsView");

function fallbackState(language) {
  return {
    config: { language },
    available: false,
    found: false,
    source: "unavailable",
  };
}

async function readState(context, language) {
  if (typeof context.settings?.getConfigurationState !== "function") return fallbackState(language);
  return context.settings.getConfigurationState(context.guildId);
}

/**
 * Compatibility export for legacy module callbacks. Runtime composition now
 * injects `settingsHome`, which refreshes the state before rendering.
 */
function settingsView(t, language) {
  return settingsHomeView({ t, language, configState: fallbackState(language) });
}

async function openSettingsPanel(context) {
  const language = await context.settings.getLanguage(context.guildId);
  const configState = await readState(context, language);
  return context.envelope.transport.reply({
    view: settingsHomeView({ t: context.t, language, configState }),
    ephemeral: true,
  });
}

async function openSettingsCategory(context) {
  const categoryId = context.envelope.values?.[0];
  const language = await context.settings.getLanguage(context.guildId);
  const configState = await readState(context, language);
  const premiumDecisions = typeof context.settings?.getPremiumDecisions === "function"
    ? await context.settings.getPremiumDecisions(context.guildId)
    : {};
  return context.envelope.transport.update({
    view: settingsCategoryView({
      t: context.t,
      language,
      categoryId,
      configState,
      premiumDecisions,
    }),
  });
}

async function returnSettingsHome(context) {
  const language = await context.settings.getLanguage(context.guildId);
  const configState = await readState(context, language);
  return context.envelope.transport.update({
    view: settingsHomeView({ t: context.t, language, configState }),
  });
}

module.exports = {
  openSettingsPanel,
  openSettingsCategory,
  returnSettingsHome,
  settingsView,
};
