"use strict";

const { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType } = require("discord.js");
const { DiscordPermission } = require("./discordPermissionMap");

// CIVRAT → Discord : contexte d'exposition d'une commande.
// Convention V1 : une commande « normale » vit UNIQUEMENT en serveur (Guild).
// Seules /ownerpanel et /recovery déclarent explicitement Guild + BotDM.
const ContextName = Object.freeze({
  guild: InteractionContextType.Guild, // 0 — serveur uniquement
  botDm: InteractionContextType.BotDM, // 1 — DM avec le bot uniquement
});

// CIVRAT → Discord : type d'installation. Discord exige USER_INSTALL dès que
// le contexte inclut BotDM/PrivateChannel (sinon le déploiement est refusé).
const IntegrationName = Object.freeze({
  guildInstall: ApplicationIntegrationType.GuildInstall, // 0
  userInstall: ApplicationIntegrationType.UserInstall, // 1
});

const DEFAULT_CONTEXTS = Object.freeze(["guild"]);
const DEFAULT_INTEGRATION_TYPES = Object.freeze(["guildInstall"]);

function resolveContexts(definition) {
  const names = Array.isArray(definition.contexts) && definition.contexts.length
    ? definition.contexts
    : DEFAULT_CONTEXTS;
  return names.map((name) => {
    const value = ContextName[name];
    if (value === undefined) throw new Error(`Unsupported command context: ${name}`);
    return value;
  });
}

function resolveIntegrationTypes(definition) {
  const names = Array.isArray(definition.integrationTypes) && definition.integrationTypes.length
    ? definition.integrationTypes
    : DEFAULT_INTEGRATION_TYPES;
  return names.map((name) => {
    const value = IntegrationName[name];
    if (value === undefined) throw new Error(`Unsupported integration type: ${name}`);
    return value;
  });
}

// Permission Discord par défaut : champ explicite `defaultMemberPermissions`
// prioritaire, sinon repli historique sur permissions.allOf[0].
function resolveDefaultMemberPermissions(definition) {
  const explicit = definition.defaultMemberPermissions;
  if (explicit) return DiscordPermission[explicit] || null;
  return definition.permissions?.allOf?.length === 1
    ? DiscordPermission[definition.permissions.allOf[0]]
    : null;
}

function toDiscordCommand(definition, execute) {
  const builder = new SlashCommandBuilder()
    .setName(definition.name)
    .setDescription(definition.description)
    .setContexts(resolveContexts(definition))
    .setIntegrationTypes(resolveIntegrationTypes(definition));

  for (const option of definition.options || []) {
    if (option.type === "user") {
      builder.addUserOption((o) => o.setName(option.name).setDescription(option.description).setRequired(Boolean(option.required)));
    } else if (option.type === "string") {
      builder.addStringOption((o) => o.setName(option.name).setDescription(option.description).setRequired(Boolean(option.required)));
    } else if (option.type === "integer") {
      builder.addIntegerOption((o) => o.setName(option.name).setDescription(option.description).setRequired(Boolean(option.required)));
    } else if (option.type === "boolean") {
      builder.addBooleanOption((o) => o.setName(option.name).setDescription(option.description).setRequired(Boolean(option.required)));
    } else if (option.type === "attachment") {
      // Correction V1 : l'option Attachment DOIT être mappée pour que Discord
      // expose une vraie sélection de fichier (type Discord = 11).
      builder.addAttachmentOption((o) => o.setName(option.name).setDescription(option.description).setRequired(Boolean(option.required)));
    }
  }

  const permission = resolveDefaultMemberPermissions(definition);
  if (permission) builder.setDefaultMemberPermissions(permission);

  return { data: builder, execute };
}

module.exports = { toDiscordCommand };
