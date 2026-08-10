"use strict";
/** Single source of translation keys owned by the Guild Settings module. */
const GuildSettingsTranslationKey = Object.freeze({ TITLE: "guildSettings.title", CURRENT_LANGUAGE: "guildSettings.currentLanguage", LANGUAGE_BUTTON: "guildSettings.languageButton", LANGUAGE_PROMPT: "guildSettings.languagePrompt", LANGUAGE_UPDATED: "guildSettings.languageUpdated", languageName: (locale) => `guildSettings.languages.${locale}` });
module.exports = { GuildSettingsTranslationKey };
