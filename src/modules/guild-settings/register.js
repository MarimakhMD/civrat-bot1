"use strict";
const {
  openSettingsPanel,
  openSettingsCategory,
  returnSettingsHome,
} = require("./interactions/openSettingsPanel");
const { showLanguageMenu, selectLanguage } = require("./interactions/selectLanguage");
const { SettingsComponentId } = require("./interactions/settingsComponents");
const { settingsCommand } = require("./commands/settingsCommand");
function registerGuildSettings({ registry, settings, i18n, settingsSections = [] }) {
  const inject = (handler) => async (context) => handler({ ...context, settings, i18n, settingsSections });
  registry.registerCommand({ ...settingsCommand, execute: inject(openSettingsPanel) });
  registry.registerButton({ customId: SettingsComponentId.LANGUAGE, permissions: settingsCommand.permissions, execute: inject(showLanguageMenu) });
  registry.registerSelectMenu({ customId: SettingsComponentId.LANGUAGE, permissions: settingsCommand.permissions, execute: inject(selectLanguage) });
  registry.registerSelectMenu({ customId: SettingsComponentId.CATEGORY, permissions: settingsCommand.permissions, execute: inject(openSettingsCategory) });
  registry.registerButton({ customId: SettingsComponentId.HOME, permissions: settingsCommand.permissions, execute: inject(returnSettingsHome) });
  return { commands: [settingsCommand] };
}
module.exports = { registerGuildSettings };
