"use strict";

const { CommandDeploymentScope } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");

const adminCommand = Object.freeze({
  name: "admin",
  description: "Administration technique CIVRAT",
  // Autorité RÉELLE : reste entièrement côté handler. CIVRAT_ADMIN est un rôle
  // CIVRAT (rôle technique de la guilde 1320817768962064384), pas une
  // permission Discord : il n'est volontairement PAS mappé dans
  // discordPermissionMap. Le panneau reste refusé génériquement hors guilde
  // technique / hors salon technique / sans rôle technique, et Admin demeure
  // en lecture seule — seul un Owner authentifié peut muter le Premium.
  permissions: { allOf: [PermissionName.CIVRAT_ADMIN] },
  // Phase 2 (P12) — visibilité Discord. Sans ce champ, /admin était visible de
  // TOUS les membres de la guilde technique : `CIVRAT_ADMIN` n'existe pas dans
  // DiscordPermission, donc resolveDefaultMemberPermissions renvoyait undefined
  // et setDefaultMemberPermissions n'était jamais appelé.
  //
  // Ce champ est légitime ICI et seulement ici : /admin est strictement
  // guild-only (contexts: ["guild"]). Contrairement à /ownerpanel et /recovery,
  // qui sont exposés en DM où default_member_permissions n'est pas évaluable et
  // masquerait la commande — d'où leur absence volontaire de ce champ.
  //
  // Effet : réduit la VISIBILITÉ, sans jamais devenir l'autorisation. La garde
  // runtime ci-dessus reste nécessaire et suffisante.
  defaultMemberPermissions: PermissionName.ADMINISTRATOR,
  deploymentScope: CommandDeploymentScope.CIVRAT_ADMIN_GUILD,
  contexts: ["guild"],
  integrationTypes: ["guildInstall"],
  options: [],
});

module.exports = { adminCommand };
