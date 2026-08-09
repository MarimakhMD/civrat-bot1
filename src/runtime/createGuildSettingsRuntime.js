"use strict";
const { ErrorResponder } = require("../core/errors");
const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../core/guild-config");
const { dictionaries: coreDictionaries, I18nService, validateTranslationParity } = require("../core/i18n");
const { InteractionContextFactory, InteractionRegistry, InteractionRouter } = require("../core/interactions");
const { PermissionService } = require("../core/permissions");
const { DiscordInteractionAdapter, toDiscordCommand } = require("../adapters/discord");
const { CaptchaConfigService, registerCaptcha } = require("../modules/captcha");
const captchaEn = require("../modules/captcha/translations/en.json");
const captchaFr = require("../modules/captcha/translations/fr.json");
const { LogsConfigService, registerLogs } = require("../modules/logs");
const logsEn = require("../modules/logs/translations/en.json");
const logsFr = require("../modules/logs/translations/fr.json");
const { AutoRoleService, registerAutoRole } = require("../modules/autorole");
const autoRoleEn = require("../modules/autorole/translations/en.json");
const autoRoleFr = require("../modules/autorole/translations/fr.json");
const { GuildSettingsService, registerGuildSettings } = require("../modules/guild-settings");
const { WelcomeGoodbyeService, registerWelcomeGoodbye } = require("../modules/welcome-goodbye");
const { WelcomeImagePipeline } = require("../modules/welcome-goodbye/image/pipeline/WelcomeImagePipeline");
const { WelcomeImageRenderer } = require("../modules/welcome-goodbye/image/rendering/WelcomeImageRenderer");
const imageTheme = require("../modules/welcome-goodbye/image/themes/civrat-default/theme");
const { WelcomeAdminLogService } = require("../modules/welcome-goodbye/services/WelcomeAdminLogService");
const { createWelcomeGoodbyeSettingsSection } = require("../modules/welcome-goodbye/interactions/welcomeGoodbyeSection");
const en = require("../modules/guild-settings/translations/en.json");
const fr = require("../modules/guild-settings/translations/fr.json");
const welcomeEn = require("../modules/welcome-goodbye/translations/en.json");
const welcomeFr = require("../modules/welcome-goodbye/translations/fr.json");
function createGuildSettingsRuntime({ legacyConfigService, logger = null }) {
  const dictionaries = {
    en: { ...coreDictionaries.en, ...en, ...welcomeEn, ...autoRoleEn, ...logsEn, ...captchaEn },
    fr: { ...coreDictionaries.fr, ...fr, ...welcomeFr, ...autoRoleFr, ...logsFr, ...captchaFr },
  }; validateTranslationParity(dictionaries);
  const i18n = new I18nService({ dictionaries, logger });
  const repository = new LegacyGuildConfigRepository({ getConfig: legacyConfigService.getGuildConfig, updateConfig: legacyConfigService.updateGuildConfig, invalidateConfig: legacyConfigService.invalidateCache });
  const guildConfigResolver = new GuildConfigResolver({ repository, logger });
  const permissions = new PermissionService({ logger }); const errorResponder = new ErrorResponder({ logger });
  const contextFactory = new InteractionContextFactory({ guildConfigResolver, i18n, permissions, errorResponder, logger });
  const registry = new InteractionRegistry(); const router = new InteractionRouter({ registry, contextFactory, logger });
  const settings = new GuildSettingsService({ guildConfigResolver, logger });
  const settingsSections = [createWelcomeGoodbyeSettingsSection, (t) => ({type:"button",customId:"civrat:v1:autorole:section",label:t("autorole.section"),style:"secondary"})];
  const registration = registerGuildSettings({ registry, settings, i18n, settingsSections });
  const imagePipeline = new WelcomeImagePipeline({ renderer: new WelcomeImageRenderer(), theme: imageTheme });
  registerAutoRole({ registry, service: new AutoRoleService({ guildConfigResolver }) });
  registerLogs({ registry, service: new LogsConfigService({ guildConfigResolver }) });
  registerCaptcha({ registry, service: new CaptchaConfigService({ guildConfigResolver }) });
  registerWelcomeGoodbye({
    imagePipeline,
    settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }),
    registry,
    service: new WelcomeGoodbyeService({ guildConfigResolver }),
    adminLogService: new WelcomeAdminLogService({ logger }),

  });
  const discord = new DiscordInteractionAdapter({ router, registry });
  return Object.freeze({ tryHandle: (interaction) => discord.tryHandle(interaction), getDiscordCommands: () => registration.commands.map((definition) => toDiscordCommand(definition, async (interaction) => discord.tryHandle(interaction))), registry });
}
module.exports = { createGuildSettingsRuntime };
