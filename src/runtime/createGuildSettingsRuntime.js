"use strict";
const { ErrorResponder } = require("../core/errors");
const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../core/guild-config");
const { dictionaries: coreDictionaries, I18nService, validateTranslationParity } = require("../core/i18n");
const { InteractionContextFactory, InteractionRegistry, InteractionRouter } = require("../core/interactions");
const { PermissionService } = require("../core/permissions");
const { DiscordInteractionAdapter, toDiscordCommand } = require("../adapters/discord");
const { TicketConfigService, TicketService, TicketWelcomeService, TicketTranscriptService, registerTickets } = require("../modules/tickets");
const { SupabaseTicketRepository } = require("../modules/tickets/persistence/SupabaseTicketRepository");
const { DiscordTicketTransport } = require("../adapters/discord/DiscordTicketTransport");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { supabase } = require("../config/database");
const ticketEn = require("../modules/tickets/translations/en.json");
const ticketFr = require("../modules/tickets/translations/fr.json");
const moderationEn = require("../modules/moderation/translations/en.json");
const moderationFr = require("../modules/moderation/translations/fr.json");
const { registerModeration } = require("../modules/moderation/register");
const { registerChannelModeration } = require("../modules/moderation/channelRegister");
const { CaptchaConfigService, registerCaptcha } = require("../modules/captcha");
const { CaptchaVerificationService } = require("../modules/captcha/services/CaptchaVerificationService");
const { DiscordCaptchaTransport } = require("../adapters/discord/DiscordCaptchaTransport");
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
const { AutoModConfigService, registerAutoMod } = require("../modules/automod");
const autoModEn = require("../modules/automod/translations/en.json");
const autoModFr = require("../modules/automod/translations/fr.json");
const { SecurityConfigService, registerSecurity } = require("../modules/security");
const securityEn = require("../modules/security/translations/en.json");
const securityFr = require("../modules/security/translations/fr.json");
const { registerSticker } = require("../modules/sticker");
const stickerEn = require("../modules/sticker/translations/en.json");
const stickerFr = require("../modules/sticker/translations/fr.json");
const { GiveawayConfigService, registerGiveaways } = require("../modules/giveaways");
const giveawayEn = require("../modules/giveaways/translations/en.json");
const giveawayFr = require("../modules/giveaways/translations/fr.json");
const { SuggestionConfigService, registerSuggestions } = require("../modules/suggestions");
const suggestionEn = require("../modules/suggestions/translations/en.json");
const suggestionFr = require("../modules/suggestions/translations/fr.json");
const { TempVoiceConfigService, registerTempVoice } = require("../modules/tempvoice");
const tempVoiceEn = require("../modules/tempvoice/translations/en.json");
const tempVoiceFr = require("../modules/tempvoice/translations/fr.json");
function createGuildSettingsRuntime({ legacyConfigService, logger = null }) {
  const dictionaries = {
    en: { ...coreDictionaries.en, ...en, ...welcomeEn, ...autoRoleEn, ...logsEn, ...captchaEn, ...ticketEn, ...moderationEn, ...autoModEn, ...securityEn, ...stickerEn, ...tempVoiceEn, ...giveawayEn, ...suggestionEn },
    fr: { ...coreDictionaries.fr, ...fr, ...welcomeFr, ...autoRoleFr, ...logsFr, ...captchaFr, ...ticketFr, ...moderationFr, ...autoModFr, ...securityFr, ...stickerFr, ...tempVoiceFr, ...giveawayFr, ...suggestionFr },
  }; validateTranslationParity(dictionaries);
  const i18n = new I18nService({ dictionaries, logger });
  const repository = new LegacyGuildConfigRepository({ getConfig: legacyConfigService.getGuildConfig, updateConfig: legacyConfigService.updateGuildConfig, invalidateConfig: legacyConfigService.invalidateCache });
  const guildConfigResolver = new GuildConfigResolver({ repository, logger });
  const permissions = new PermissionService({ logger }); const errorResponder = new ErrorResponder({ logger });
  const contextFactory = new InteractionContextFactory({ guildConfigResolver, i18n, permissions, errorResponder, logger });
  const registry = new InteractionRegistry(); const router = new InteractionRouter({ registry, contextFactory, logger });
  const settings = new GuildSettingsService({ guildConfigResolver, logger });
  const settingsSections = [createWelcomeGoodbyeSettingsSection, (t) => ({type:"button",customId:"civrat:v1:autorole:section",label:t("autorole.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:automod:section",label:t("automod.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:security:section",label:t("security.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:tempvoice:section",label:t("tempvoice.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:giveaway:section",label:t("giveaway.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:suggestion:section",label:t("suggestion.section"),style:"secondary"})];
  const registration = registerGuildSettings({ registry, settings, i18n, settingsSections });
  const moderationRegistration = registerModeration({ registry });
  const channelModerationRegistration = registerChannelModeration({ registry });
  const imagePipeline = new WelcomeImagePipeline({ renderer: new WelcomeImageRenderer(), theme: imageTheme });
  registerAutoRole({ registry, service: new AutoRoleService({ guildConfigResolver }) });
  registerLogs({ registry, service: new LogsConfigService({ guildConfigResolver }) });
  const captchaConfigService = new CaptchaConfigService({ guildConfigResolver });
  const ticketConfigService = new TicketConfigService({ guildConfigResolver });
  registerTickets({
    registry,
    service: ticketConfigService,
    creationServiceFactory: (context) => new TicketService({
      configService: ticketConfigService,
      repository: new SupabaseTicketRepository({ supabase }),
      welcomeService: new TicketWelcomeService(),
      transcriptService: new TicketTranscriptService(),
      ticketLog: (event) => getLogsRuntime().handleTicketEvent({ guild: context.envelope.discordMember.guild, ...event }),
      transport: new DiscordTicketTransport({ guild: context.envelope.discordMember?.guild }),
    }),
    settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }),
  });
  registerCaptcha({
    registry,
    service: captchaConfigService,
    verificationServiceFactory: (context) => new CaptchaVerificationService({
      configService: captchaConfigService,
      transport: new DiscordCaptchaTransport({
        guild: context.envelope.discordMember.guild,
        member: context.envelope.discordMember,
      }),
    }),
    settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }),
  });
  registerWelcomeGoodbye({
    imagePipeline,
    settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }),
    registry,
    service: new WelcomeGoodbyeService({ guildConfigResolver }),
    adminLogService: new WelcomeAdminLogService({ logger }),

  });
  const autoModConfigService = new AutoModConfigService({ guildConfigResolver });
  const autoModRegistration = registerAutoMod({ registry, service: autoModConfigService, settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }) });
  const securityConfigService = new SecurityConfigService({ guildConfigResolver });
  registerSecurity({ registry, service: securityConfigService, settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }) });
  const stickerRegistration = registerSticker({ registry });
  const giveawayConfigService = new GiveawayConfigService({ guildConfigResolver });
  const giveawayRegistration = registerGiveaways({ registry, configService: giveawayConfigService, supabase, logsRuntimeFactory: () => getLogsRuntime(), settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }) });
  const suggestionConfigService = new SuggestionConfigService({ guildConfigResolver });
  const suggestionRegistration = registerSuggestions({ registry, configService: suggestionConfigService, supabase, logsRuntimeFactory: () => getLogsRuntime(), settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }) });
  const tempVoiceConfigService = new TempVoiceConfigService({ guildConfigResolver });
  registerTempVoice({ registry, service: tempVoiceConfigService, settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }) });
  const discord = new DiscordInteractionAdapter({ router, registry });
  return Object.freeze({ tryHandle: (interaction) => discord.tryHandle(interaction), getDiscordCommands: () => [...registration.commands, ...moderationRegistration.commands, ...channelModerationRegistration.commands, ...autoModRegistration.commands, ...stickerRegistration.commands, ...giveawayRegistration.commands, ...suggestionRegistration.commands].map((definition) => toDiscordCommand(definition, async (interaction) => discord.tryHandle(interaction))), registry });
}
module.exports = { createGuildSettingsRuntime };
