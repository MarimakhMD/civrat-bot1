"use strict";
const { ErrorResponder } = require("../core/errors");
const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../core/guild-config");
const { dictionaries: coreDictionaries, I18nService, validateTranslationParity } = require("../core/i18n");
const { InteractionContextFactory, InteractionRegistry, InteractionRouter } = require("../core/interactions");
const { PermissionService } = require("../core/permissions");
const { TechnicalAdminProvider } = require("../modules/admin-panel/services/TechnicalAdminProvider");
const { AdminSystemService } = require("../modules/admin-panel/services/AdminSystemService");
const { DiscordInteractionAdapter, toDiscordCommand } = require("../adapters/discord");
const { TicketConfigService, TicketService, TicketWelcomeService, TicketTranscriptService, registerTickets } = require("../modules/tickets");
const { TicketPremiumConfigResolver } = require("../modules/tickets/services/TicketPremiumConfigResolver");
const { getEntitlementService } = require("./getEntitlementService");
const { SupabaseTicketRepository } = require("../modules/tickets/persistence/SupabaseTicketRepository");
const { SupabaseTicketCounterRepository } = require("../modules/tickets/persistence/SupabaseTicketCounterRepository");
const { TicketChannelNamingService } = require("../modules/tickets/services/TicketChannelNamingService");
const { DiscordTicketTransport } = require("../adapters/discord/DiscordTicketTransport");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { config } = require("../config");
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
const { WelcomeTemplateRegistry } = require("../modules/welcome-goodbye/rendering/WelcomeTemplateRegistry");
const { WelcomeResourceCache } = require("../modules/welcome-goodbye/rendering/WelcomeResourceCache");
const imageTheme = require("../modules/welcome-goodbye/image/themes/civrat-default/theme");
const { WelcomeAdminLogService } = require("../modules/welcome-goodbye/services/WelcomeAdminLogService");
const { returnSettingsHome } = require("../modules/guild-settings/interactions/openSettingsPanel");
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
const { registerAnalytics } = require("../modules/analytics/register");
const analyticsEn = require("../modules/analytics/translations/en.json");
const analyticsFr = require("../modules/analytics/translations/fr.json");
// Phase 11 — Analytics unifié : la composition utilise le MÊME runtime (et
// donc les mêmes repositories) que le chemin d'écriture des événements.
const { getAnalyticsRuntime } = require("../modules/analytics/runtime/getAnalyticsRuntime");
const { XPConfigService, registerXPSettings } = require("../modules/xp");
const xpEn = require("../modules/xp/translations/en.json");
const xpFr = require("../modules/xp/translations/fr.json");
const { InviteConfigService } = require("../modules/invites/services/InviteConfigService");
const { registerInvites } = require("../modules/invites/register");
const invitesEn = require("../modules/invites/translations/en.json");
const invitesFr = require("../modules/invites/translations/fr.json");
const { getRecoveryRuntime } = require("../modules/recovery/runtime/getRecoveryRuntime");
const recoveryEn = require("../modules/recovery/translations/en.json");
const recoveryFr = require("../modules/recovery/translations/fr.json");
const { CivratIdentityOwnerProvider } = require("../modules/owner-panel/services/CivratIdentityOwnerProvider");
const { getOwnerPanelRuntime } = require("../modules/owner-panel/runtime/getOwnerPanelRuntime");
const ownerPanelEn = require("../modules/owner-panel/translations/en.json");
const ownerPanelFr = require("../modules/owner-panel/translations/fr.json");
const { registerAdminPanel } = require("../modules/admin-panel/register");
const adminPanelEn = require("../modules/admin-panel/translations/en.json");
const adminPanelFr = require("../modules/admin-panel/translations/fr.json");
// Service legacy d'invitations : son statsRepository est le stockage réel du
// tracking (guildMemberAdd/Remove) — on le partage avec /invites et Analytics.
const legacyInviteService = require("../services/inviteService");
function createGuildSettingsRuntime({ legacyConfigService, logger = null }) {
  const dictionaries = {
    en: { ...coreDictionaries.en, ...en, ...welcomeEn, ...autoRoleEn, ...logsEn, ...captchaEn, ...ticketEn, ...moderationEn, ...autoModEn, ...securityEn, ...stickerEn, ...tempVoiceEn, ...giveawayEn, ...suggestionEn, ...analyticsEn, ...xpEn, ...invitesEn, ...recoveryEn, ...ownerPanelEn, ...adminPanelEn },
    fr: { ...coreDictionaries.fr, ...fr, ...welcomeFr, ...autoRoleFr, ...logsFr, ...captchaFr, ...ticketFr, ...moderationFr, ...autoModFr, ...securityFr, ...stickerFr, ...tempVoiceFr, ...giveawayFr, ...suggestionFr, ...analyticsFr, ...xpFr, ...invitesFr, ...recoveryFr, ...ownerPanelFr, ...adminPanelFr },
  }; validateTranslationParity(dictionaries);
  const i18n = new I18nService({ dictionaries, logger });
  const repository = new LegacyGuildConfigRepository({ getConfig: legacyConfigService.getGuildConfig, updateConfig: legacyConfigService.updateGuildConfig, invalidateConfig: legacyConfigService.invalidateCache });
  const guildConfigResolver = new GuildConfigResolver({ repository, logger });
  // P20 — couture CIVRAT_OWNER désormais ACTIVE : le provider concret
  // (Owner CIVRAT = env initial puis persistance PostgreSQL) est injecté ici,
  // point de composition prévu par le core. Fail-closed (erreur => false).
  const civratOwnerProvider = new CivratIdentityOwnerProvider({ identityServiceFactory: () => getOwnerPanelRuntime().identity, logger });
  const technicalAdminProvider = new TechnicalAdminProvider({
    guildId: config.civratAdminGuildId,
    channelId: config.civratAdminChannelId,
    roleId: config.civratAdminRoleId,
    logger,
  });
  const permissions = new PermissionService({
    civratAdminProvider: technicalAdminProvider,
    civratOwnerProvider,
    logger,
  });
  const errorResponder = new ErrorResponder({ logger });
  const contextFactory = new InteractionContextFactory({ guildConfigResolver, i18n, permissions, errorResponder, logger });
  const registry = new InteractionRegistry(); const router = new InteractionRouter({ registry, contextFactory, logger });
  const entitlementService = getEntitlementService();
  const configurationReader = typeof legacyConfigService.getGuildConfigState === "function"
    ? legacyConfigService.getGuildConfigState
    : async (guildId) => {
      const config = await legacyConfigService.getGuildConfig(guildId);
      return { config, available: true, found: Boolean(config && Object.keys(config).length), source: "legacy" };
    };
  const settings = new GuildSettingsService({
    guildConfigResolver,
    configurationReader,
    entitlementService,
    logger,
  });
  const settingsHome = async (context) => returnSettingsHome({ ...context, settings });
  const adminSystem = new AdminSystemService({
    technicalConfig: {
      guildId: config.civratAdminGuildId,
      channelId: config.civratAdminChannelId,
      roleId: config.civratAdminRoleId,
    },
    configurationReader,
    entitlementService,
    logger,
  });
  const ownerRuntime = getOwnerPanelRuntime();
  const adminRuntime = Object.freeze({
    ...ownerRuntime,
    technicalAdminProvider,
    system: adminSystem,
    recoveryServiceFactory: () => getRecoveryRuntime().serviceFactory(),
  });
  const registration = registerGuildSettings({ registry, settings, i18n });
  const moderationRegistration = registerModeration({ registry });
  const channelModerationRegistration = registerChannelModeration({ registry });
  const welcomeTemplateRegistry = new WelcomeTemplateRegistry(); welcomeTemplateRegistry.discover();
  const imagePipeline = new WelcomeImagePipeline({ renderer: new WelcomeImageRenderer({ resourceCache: new WelcomeResourceCache() }), theme: imageTheme });
  registerAutoRole({ registry, service: new AutoRoleService({ guildConfigResolver }) });
  registerLogs({ registry, service: new LogsConfigService({ guildConfigResolver }), settingsHome });
  const captchaConfigService = new CaptchaConfigService({ guildConfigResolver });
  const ticketConfigService = new TicketConfigService({ guildConfigResolver });
  // Le resolver Tickets et tous les autres consommateurs Premium partagent le
  // même EntitlementService runtime ; aucun cache ou repository parallèle.
  const ticketPremiumConfigResolver = new TicketPremiumConfigResolver({ entitlementService, logger });
  registerTickets({
    registry,
    service: ticketConfigService,
    premiumConfigResolver: ticketPremiumConfigResolver,
    creationServiceFactory: (context) => new TicketService({
      configService: ticketConfigService,
      repository: new SupabaseTicketRepository({ supabase }),
      welcomeService: new TicketWelcomeService(),
      transcriptService: new TicketTranscriptService(),
      premiumConfigResolver: ticketPremiumConfigResolver,
      // Phase 10.4 : compteur atomique (RPC Supabase, fail-closed si absente)
      // + nommage Premium des salons.
      counterRepository: new SupabaseTicketCounterRepository({ supabase }),
      channelNamingService: new TicketChannelNamingService(),
      ticketLog: (event) => getLogsRuntime().handleTicketEvent({ guild: context.envelope.discordMember.guild, ...event }),
      transport: new DiscordTicketTransport({ guild: context.envelope.discordMember?.guild }),
    }),
    settingsHome,
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
    settingsHome,
  });
  registerWelcomeGoodbye({
    imagePipeline,
    templateRegistry: welcomeTemplateRegistry,
    settingsHome,
    registry,
    service: new WelcomeGoodbyeService({ guildConfigResolver }),
    adminLogService: new WelcomeAdminLogService({ logger }),
    // Phase Premium — gate centralisée : l'aperçu de la carte Welcome image
    // exige l'entitlement WELCOME_IMAGE (le service est partagé avec le
    // panneau Tickets/Admin, une seule source de vérité Premium).
    entitlementService,

  });
  const autoModConfigService = new AutoModConfigService({ guildConfigResolver });
  const autoModRegistration = registerAutoMod({ registry, service: autoModConfigService, settingsHome });
  const securityConfigService = new SecurityConfigService({ guildConfigResolver });
  registerSecurity({ registry, service: securityConfigService, settingsHome });
  const stickerRegistration = registerSticker({ registry });
  const giveawayConfigService = new GiveawayConfigService({ guildConfigResolver });
  const giveawayRegistration = registerGiveaways({ registry, configService: giveawayConfigService, supabase, logsRuntimeFactory: () => getLogsRuntime(), settingsHome });
  const suggestionConfigService = new SuggestionConfigService({ guildConfigResolver });
  const suggestionRegistration = registerSuggestions({ registry, configService: suggestionConfigService, supabase, logsRuntimeFactory: () => getLogsRuntime(), settingsHome });
  const tempVoiceConfigService = new TempVoiceConfigService({ guildConfigResolver });
  registerTempVoice({ registry, service: tempVoiceConfigService, settingsHome });
  // Phase 11 — fin des instances Analytics disjointes : la composition lit et
  // écrit via le runtime Analytics partagé (mêmes repositories que les
  // événements messageCreate/guildMemberAdd). Plus aucune instance privée.
  const analyticsRuntime = getAnalyticsRuntime();
  const analyticsRegistration = registerAnalytics({ registry, configService: analyticsRuntime._configService, analyticsService: analyticsRuntime._service, settingsHome });
  // Phase 11 — XP et Invites rejoignent /settings et les commandes publiques.
  registerXPSettings({ registry, configService: new XPConfigService({ guildConfigResolver }), settingsHome });
  const invitesRegistration = registerInvites({ registry, configService: new InviteConfigService({ guildConfigResolver }), inviteService: legacyInviteService, settingsHome });
  // Le registre Admin réutilise les routes Owner/Recovery utiles, mais expose
  // une seule commande technique : /admin.
  const adminRegistration = registerAdminPanel({ registry, runtimeFactory: () => adminRuntime });
  const discord = new DiscordInteractionAdapter({ router, registry });
  const commandDefinitions = [
    ...registration.commands,
    ...moderationRegistration.commands,
    ...channelModerationRegistration.commands,
    ...autoModRegistration.commands,
    ...stickerRegistration.commands,
    ...giveawayRegistration.commands,
    ...suggestionRegistration.commands,
    ...analyticsRegistration.commands,
    ...invitesRegistration.commands,
    ...adminRegistration.commands,
  ];
  return Object.freeze({
    tryHandle: (interaction) => discord.tryHandle(interaction),
    getDiscordCommands: () => commandDefinitions.map((definition) => (
      toDiscordCommand(definition, async (interaction) => discord.tryHandle(interaction))
    )),
    registry,
    ticketPremiumResolver: ticketPremiumConfigResolver,
  });
}
module.exports = { createGuildSettingsRuntime };
