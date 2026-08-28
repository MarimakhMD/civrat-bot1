"use strict";
const { ErrorResponder } = require("../core/errors");
const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../core/guild-config");
const { dictionaries: coreDictionaries, I18nService, validateTranslationParity } = require("../core/i18n");
const { InteractionContextFactory, InteractionRegistry, InteractionRouter } = require("../core/interactions");
const { PermissionService } = require("../core/permissions");
const { DiscordInteractionAdapter, toDiscordCommand } = require("../adapters/discord");
const { TicketConfigService, TicketService, TicketWelcomeService, TicketTranscriptService, registerTickets } = require("../modules/tickets");
const { TicketPremiumConfigResolver } = require("../modules/tickets/services/TicketPremiumConfigResolver");
const { EntitlementService } = require("../core/entitlements");
const { SupabaseEntitlementRepository } = require("../adapters/supabase");
const { SupabaseTicketRepository } = require("../modules/tickets/persistence/SupabaseTicketRepository");
const { SupabaseTicketCounterRepository } = require("../modules/tickets/persistence/SupabaseTicketCounterRepository");
const { TicketChannelNamingService } = require("../modules/tickets/services/TicketChannelNamingService");
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
const { WelcomeTemplateRegistry } = require("../modules/welcome-goodbye/rendering/WelcomeTemplateRegistry");
const { WelcomeResourceCache } = require("../modules/welcome-goodbye/rendering/WelcomeResourceCache");
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
const { registerRecovery } = require("../modules/recovery/register");
const { getRecoveryRuntime } = require("../modules/recovery/runtime/getRecoveryRuntime");
const recoveryEn = require("../modules/recovery/translations/en.json");
const recoveryFr = require("../modules/recovery/translations/fr.json");
const { registerOwnerPanel } = require("../modules/owner-panel/register");
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
  const permissions = new PermissionService({ civratOwnerProvider, logger }); const errorResponder = new ErrorResponder({ logger });
  const contextFactory = new InteractionContextFactory({ guildConfigResolver, i18n, permissions, errorResponder, logger });
  const registry = new InteractionRegistry(); const router = new InteractionRouter({ registry, contextFactory, logger });
  const settings = new GuildSettingsService({ guildConfigResolver, logger });
  const settingsSections = [createWelcomeGoodbyeSettingsSection, (t) => ({type:"button",customId:"civrat:v1:autorole:section",label:t("autorole.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:automod:section",label:t("automod.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:security:section",label:t("security.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:tempvoice:section",label:t("tempvoice.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:giveaway:section",label:t("giveaway.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:suggestion:section",label:t("suggestion.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:tickets:panel",label:t("tickets.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:captcha:section",label:t("captcha.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:logs:section",label:t("logs.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:analytics:section",label:t("analytics.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:xp:section",label:t("xp.section"),style:"secondary"}), (t) => ({type:"button",customId:"civrat:v1:invites:section",label:t("invites.section"),style:"secondary"})];
  const registration = registerGuildSettings({ registry, settings, i18n, settingsSections });
  const moderationRegistration = registerModeration({ registry });
  const channelModerationRegistration = registerChannelModeration({ registry });
  const welcomeTemplateRegistry = new WelcomeTemplateRegistry(); welcomeTemplateRegistry.discover();
  const imagePipeline = new WelcomeImagePipeline({ renderer: new WelcomeImageRenderer({ resourceCache: new WelcomeResourceCache() }), theme: imageTheme });
  registerAutoRole({ registry, service: new AutoRoleService({ guildConfigResolver }) });
  registerLogs({ registry, service: new LogsConfigService({ guildConfigResolver }), settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }) });
  const captchaConfigService = new CaptchaConfigService({ guildConfigResolver });
  const ticketConfigService = new TicketConfigService({ guildConfigResolver });
  // Phase 10.1 — fondations Ticket Premium : l'entitlement est lu via Supabase
  // et injecté dans un resolver en couches (defaults Free, overrides Premium
  // uniquement si TICKET_PREMIUM actif). Aucune route ni aucun cycle de vie
  // Ticket Free n'est modifié ; la consommation arrive en 10.2+.
  const entitlementService = new EntitlementService({ repository: new SupabaseEntitlementRepository({ supabase }) });
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
    templateRegistry: welcomeTemplateRegistry,
    settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }),
    registry,
    service: new WelcomeGoodbyeService({ guildConfigResolver }),
    adminLogService: new WelcomeAdminLogService({ logger }),
    // Phase Premium — gate centralisée : l'aperçu de la carte Welcome image
    // exige l'entitlement WELCOME_IMAGE (le service est partagé avec le
    // panneau Tickets/Admin, une seule source de vérité Premium).
    entitlementService,

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
  // Phase 11 — fin des instances Analytics disjointes : la composition lit et
  // écrit via le runtime Analytics partagé (mêmes repositories que les
  // événements messageCreate/guildMemberAdd). Plus aucune instance privée.
  const analyticsRuntime = getAnalyticsRuntime();
  const analyticsRegistration = registerAnalytics({ registry, configService: analyticsRuntime._configService, analyticsService: analyticsRuntime._service, settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }) });
  // Phase 11 — XP et Invites rejoignent /settings et les commandes publiques.
  registerXPSettings({ registry, configService: new XPConfigService({ guildConfigResolver }), settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }) });
  const invitesRegistration = registerInvites({ registry, configService: new InviteConfigService({ guildConfigResolver }), inviteService: legacyInviteService, settingsHome: async (context) => context.envelope.transport.update({ view: require("../modules/guild-settings/interactions/openSettingsPanel").settingsView(context.t, await settings.getLanguage(context.guildId), settingsSections) }) });
  // P20 — récupération propriétaire : commande publique, double facteur
  // (Master Code env-only + code e-mail à usage unique). Aucune permission
  // requise par conception ; aucune surface d'administration n'en dépend.
  const recoveryRegistration = registerRecovery({ registry, serviceFactory: () => getRecoveryRuntime().serviceFactory() });
  // P20 — Owner Panel CIVRAT : ouverture contrôlée dynamiquement (Owner /
  // Admins CIVRAT / élévation Recovery), contenu sous Master Code, actions
  // réservées à CIVRAT_OWNER (vérifiées par le router sur chaque route).
  const ownerPanelRegistration = registerOwnerPanel({ registry, runtimeFactory: getOwnerPanelRuntime });
  // Admin Panel opérationnel : mêmes routes de composition, garde d'accès
  // re-vérifiée dans chaque handler (Admin persistant OU Owner authentifié).
  registerAdminPanel({ registry, runtimeFactory: getOwnerPanelRuntime });
  const discord = new DiscordInteractionAdapter({ router, registry });
  return Object.freeze({ tryHandle: (interaction) => discord.tryHandle(interaction), getDiscordCommands: () => [...registration.commands, ...moderationRegistration.commands, ...channelModerationRegistration.commands, ...autoModRegistration.commands, ...stickerRegistration.commands, ...giveawayRegistration.commands, ...suggestionRegistration.commands, ...analyticsRegistration.commands, ...invitesRegistration.commands, ...recoveryRegistration.commands, ...ownerPanelRegistration.commands].map((definition) => toDiscordCommand(definition, async (interaction) => discord.tryHandle(interaction))), registry, ticketPremiumResolver: ticketPremiumConfigResolver });
}
module.exports = { createGuildSettingsRuntime };
