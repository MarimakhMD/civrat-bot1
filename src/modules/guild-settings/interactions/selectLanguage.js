"use strict";
const { SupportedLocale } = require("../../../core/i18n");
const { settingsView } = require("./openSettingsPanel");
const { GuildSettingsTranslationKey: Key } = require("../translations/translationKeys");
async function showLanguageMenu(context) { await context.envelope.transport.update({ view: { title: context.t(Key.TITLE), content: context.t(Key.LANGUAGE_PROMPT), components: [{ type: "select", customId: require("./settingsComponents").SettingsComponentId.LANGUAGE, placeholder: context.t(Key.LANGUAGE_PROMPT), options: Object.values(SupportedLocale).map((value) => ({ value, label: context.t(Key.languageName(value)) })) }] } }); }
async function selectLanguage(context) { const language = context.envelope.values?.[0]; const config = await context.settings.updateLanguage(context.guildId, language); const t = context.i18n.forLocale(config.language); await context.envelope.transport.update({ view: { ...settingsView(t, config.language), content: `${t(Key.LANGUAGE_UPDATED, { language: t(Key.languageName(config.language)) })}\n${settingsView(t, config.language).content}` } }); }
module.exports = { showLanguageMenu, selectLanguage };
