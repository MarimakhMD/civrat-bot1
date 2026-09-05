"use strict";

const { EntitlementFeature } = require("../../../core/entitlements");
const { PermissionName } = require("../../../core/permissions");

const SettingsCategoryId = Object.freeze({
  GENERAL: "general",
  PROTECTION: "protection",
  WELCOME: "welcome",
  TICKETS: "tickets",
  COMMUNITY: "community",
  ANALYTICS: "analytics",
  LOGS: "logs",
});

function enabledBy(key, defaultValue = false) {
  return (config) => config?.[key] === undefined ? defaultValue : Boolean(config[key]);
}

function configuredByAll(...keys) {
  return (config) => keys.every((key) => Boolean(config?.[key]));
}

function feature({
  id,
  labelKey,
  customId,
  isEnabled,
  isConfigured = () => true,
  premiumFeatures = [],
}) {
  return Object.freeze({
    id,
    labelKey,
    customId,
    isEnabled,
    isConfigured,
    premiumFeatures: Object.freeze([...premiumFeatures]),
  });
}

const SETTINGS_CATALOG = Object.freeze([
  Object.freeze({
    id: SettingsCategoryId.GENERAL,
    labelKey: "guildSettings.categories.general",
    descriptionKey: "guildSettings.categoryDescriptions.general",
    includeLanguage: true,
    permission: PermissionName.MANAGE_GUILD,
    features: Object.freeze([
      feature({
        id: "autorole",
        labelKey: "autorole.section",
        customId: "civrat:v1:autorole:section",
        isEnabled: enabledBy("autorole_enabled"),
        isConfigured: (config) => Boolean(config?.autorole_member_role_id || config?.autorole_bot_role_id),
      }),
      feature({
        id: "tempvoice",
        labelKey: "tempvoice.section",
        customId: "civrat:v1:tempvoice:section",
        isEnabled: enabledBy("tempvoice_enabled"),
        isConfigured: configuredByAll("tempvoice_lobby_channel_id", "tempvoice_category_id"),
      }),
    ]),
  }),
  Object.freeze({
    id: SettingsCategoryId.PROTECTION,
    labelKey: "guildSettings.categories.protection",
    descriptionKey: "guildSettings.categoryDescriptions.protection",
    includeLanguage: false,
    permission: PermissionName.MANAGE_GUILD,
    features: Object.freeze([
      feature({
        id: "automod",
        labelKey: "automod.section",
        customId: "civrat:v1:automod:section",
        isEnabled: enabledBy("automod_enabled"),
      }),
      feature({
        id: "security",
        labelKey: "security.section",
        customId: "civrat:v1:security:section",
        isEnabled: enabledBy("security_enabled"),
      }),
      feature({
        id: "captcha",
        labelKey: "captcha.section",
        customId: "civrat:v1:captcha:section",
        isEnabled: enabledBy("captcha_enabled"),
        isConfigured: configuredByAll("captcha_channel_id", "captcha_role_id"),
      }),
    ]),
  }),
  Object.freeze({
    id: SettingsCategoryId.WELCOME,
    labelKey: "guildSettings.categories.welcome",
    descriptionKey: "guildSettings.categoryDescriptions.welcome",
    includeLanguage: false,
    permission: PermissionName.MANAGE_GUILD,
    features: Object.freeze([
      feature({
        id: "welcome-goodbye",
        labelKey: "welcomeGoodbye.section",
        customId: "civrat:v1:welcome-goodbye:section",
        isEnabled: (config) => Boolean(config?.welcome_enabled || config?.goodbye_enabled),
        isConfigured: (config) => (
          (!config?.welcome_enabled || Boolean(config?.welcome_channel_id))
          && (!config?.goodbye_enabled || Boolean(config?.goodbye_channel_id))
        ),
        premiumFeatures: [EntitlementFeature.WELCOME_IMAGE],
      }),
    ]),
  }),
  Object.freeze({
    id: SettingsCategoryId.TICKETS,
    labelKey: "guildSettings.categories.tickets",
    descriptionKey: "guildSettings.categoryDescriptions.tickets",
    includeLanguage: false,
    permission: PermissionName.MANAGE_GUILD,
    features: Object.freeze([
      feature({
        id: "tickets",
        labelKey: "tickets.section",
        customId: "civrat:v1:tickets:panel",
        isEnabled: enabledBy("tickets_enabled"),
        isConfigured: configuredByAll("ticket_category_id", "ticket_support_role_id"),
        premiumFeatures: [EntitlementFeature.TICKET_PREMIUM],
      }),
    ]),
  }),
  Object.freeze({
    id: SettingsCategoryId.COMMUNITY,
    labelKey: "guildSettings.categories.community",
    descriptionKey: "guildSettings.categoryDescriptions.community",
    includeLanguage: false,
    permission: PermissionName.MANAGE_GUILD,
    features: Object.freeze([
      feature({
        id: "giveaways",
        labelKey: "giveaway.section",
        customId: "civrat:v1:giveaway:section",
        isEnabled: enabledBy("giveaways_enabled"),
        // C1 : isConfigured retiré. Il vérifiait giveaway_channel_id, colonne
        // inexistante et sans remplacement : aucun salon Giveaway n'est
        // configuré, la publication se fait dans le salon de la commande.
        // Le défaut de feature() (isConfigured = () => true) s'applique donc :
        // un giveaway est considéré configuré dès qu'il est activé.
      }),
      feature({
        id: "suggestions",
        labelKey: "suggestion.section",
        customId: "civrat:v1:suggestion:section",
        isEnabled: enabledBy("suggestions_enabled"),
        isConfigured: configuredByAll("suggestions_channel_id"),
      }),
    ]),
  }),
  Object.freeze({
    id: SettingsCategoryId.ANALYTICS,
    labelKey: "guildSettings.categories.analytics",
    descriptionKey: "guildSettings.categoryDescriptions.analytics",
    includeLanguage: false,
    permission: PermissionName.MANAGE_GUILD,
    features: Object.freeze([
      feature({
        id: "analytics",
        labelKey: "analytics.section",
        customId: "civrat:v1:analytics:section",
        isEnabled: enabledBy("analytics_enabled"),
      }),
      feature({
        id: "xp",
        labelKey: "xp.section",
        customId: "civrat:v1:xp:section",
        isEnabled: enabledBy("xp_enabled"),
      }),
      feature({
        id: "invites",
        labelKey: "invites.section",
        customId: "civrat:v1:invites:section",
        isEnabled: enabledBy("invitations_enabled", true),
      }),
    ]),
  }),
  Object.freeze({
    id: SettingsCategoryId.LOGS,
    labelKey: "guildSettings.categories.logs",
    descriptionKey: "guildSettings.categoryDescriptions.logs",
    includeLanguage: false,
    permission: PermissionName.MANAGE_GUILD,
    features: Object.freeze([
      feature({
        id: "logs",
        labelKey: "logs.section",
        customId: "civrat:v1:logs:section",
        isEnabled: enabledBy("logs_enabled"),
        isConfigured: (config) => [
          "log_channel_update_channel_id",
          "log_member_join_channel_id",
          "log_member_leave_channel_id",
          "log_message_delete_channel_id",
          "log_message_edit_channel_id",
          "log_moderation_channel_id",
          "log_role_update_channel_id",
        ].some((key) => Boolean(config?.[key])),
      }),
    ]),
  }),
]);

function findSettingsCategory(categoryId) {
  return SETTINGS_CATALOG.find((category) => category.id === categoryId) || null;
}

function evaluateSettingsFeature(featureDefinition, config = {}) {
  const enabled = Boolean(featureDefinition.isEnabled(config));
  return Object.freeze({
    enabled,
    configured: enabled ? Boolean(featureDefinition.isConfigured(config)) : null,
  });
}

module.exports = {
  SettingsCategoryId,
  SETTINGS_CATALOG,
  findSettingsCategory,
  evaluateSettingsFeature,
};
