"use strict";

// Phase 2 (P12) — Exposition Discord de /admin.
//
// Avant le correctif, /admin était déployé SANS default_member_permissions :
// `permissions.allOf` vaut ["CIVRAT_ADMIN"], or CIVRAT_ADMIN est un RÔLE CIVRAT
// et non une permission Discord, donc absent de discordPermissionMap.
// resolveDefaultMemberPermissions renvoyait undefined et
// setDefaultMemberPermissions n'était jamais appelé — la commande était visible
// de tous les membres de la guilde technique.
//
// Ce fichier verrouille la visibilité Discord SANS jamais affaiblir l'autorité
// réelle, qui reste la garde runtime (guilde technique + salon technique + rôle
// technique), couverte par test/runtime/admin-command-access.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const commandHandler = require("../../src/handlers/commandHandler");
const { toDiscordCommand } = require("../../src/adapters/discord/DiscordCommandAdapter");
const { DiscordPermission } = require("../../src/adapters/discord/discordPermissionMap");
const { PermissionName } = require("../../src/core/permissions");
const { adminCommand } = require("../../src/modules/admin-panel/commands/adminCommand");
const { prepareDeploymentPlan, validateDeploymentPlan } = require("../../deploy");

const ADMINISTRATOR_BITFIELD = "8";

function adminJson() {
  return toDiscordCommand(adminCommand, async () => {}).data.toJSON();
}

test("/admin déclare default_member_permissions = Administrator", () => {
  const json = adminJson();
  assert.equal(json.default_member_permissions, ADMINISTRATOR_BITFIELD,
    "/admin ne doit plus être visible de tous les membres de la guilde technique");
  assert.equal(DiscordPermission[PermissionName.ADMINISTRATOR], 8n);
});

test("/admin reste strictement guild-only et de portée technique", () => {
  const json = adminJson();
  assert.deepEqual(json.contexts, [0], "serveur uniquement");
  assert.deepEqual(json.integration_types, [0], "Guild Install uniquement");
  assert.equal(json.contexts.includes(1), false, "/admin ne doit pas être disponible en DM");
  assert.equal(toDiscordCommand(adminCommand, async () => {}).deploymentScope, "civrat-admin-guild");
});

test("l'autorité réelle reste la garde runtime CIVRAT_ADMIN, inchangée", () => {
  // default_member_permissions réduit la VISIBILITÉ ; il ne devient jamais
  // l'autorisation. La permission CIVRAT portée par la définition neutre est
  // celle que le routeur évalue.
  assert.deepEqual(adminCommand.permissions.allOf, [PermissionName.CIVRAT_ADMIN]);
  assert.equal(adminCommand.permissions.allOf.length, 1);
});

test("CIVRAT_ADMIN n'est pas et ne doit pas devenir un bitfield Discord", () => {
  // Le rôle technique (1542958959907053688) n'a pas d'équivalent Discord :
  // le mapper sur un bitfield ferait croire à une équivalence inexistante et
  // remplacerait silencieusement l'autorité runtime par une permission Discord.
  assert.equal(DiscordPermission[PermissionName.CIVRAT_ADMIN], undefined);
  assert.equal(DiscordPermission[PermissionName.CIVRAT_OWNER], undefined);
  assert.deepEqual(Object.keys(DiscordPermission).sort(), [
    "ADMINISTRATOR", "BAN_MEMBERS", "KICK_MEMBERS", "MANAGE_CHANNELS", "MANAGE_GUILD",
    "MANAGE_MESSAGES", "MANAGE_NICKNAMES", "MANAGE_ROLES", "MODERATE_MEMBERS",
  ]);
});

test("aucune commande exposée en DM ne porte de default_member_permissions", () => {
  // Justification conservée de /ownerpanel et /recovery : default_member_permissions
  // n'est pas évaluable en DM et y masquerait la commande. Garde structurelle.
  const loaded = commandHandler.loadCommands();
  for (const [name, command] of loaded) {
    const json = command.data.toJSON();
    if ((json.contexts || []).includes(1)) {
      assert.equal(json.default_member_permissions, undefined,
        `/${name} est exposée en DM et ne doit pas porter de default_member_permissions`);
    }
  }
});

test("le plan de déploiement reste valide après l'ajout du champ", () => {
  const loaded = commandHandler.loadCommands();
  const plan = prepareDeploymentPlan(loaded);
  assert.deepEqual(validateDeploymentPlan(plan), [], "aucun problème de catalogue");
  assert.equal(plan.global.length, 22);
  assert.equal(plan.technical.length, 1);
  assert.equal(plan.technical[0].name, "admin");
  assert.equal(plan.technical[0].default_member_permissions, ADMINISTRATOR_BITFIELD,
    "le champ atteint bien la charge utile réellement envoyée à Discord");
});

// Photographie exacte mesurée : 18 des 22 commandes globales portent déjà une
// permission par défaut (repli historique permissions.allOf[0] dans
// resolveDefaultMemberPermissions) ; les 4 commandes publiques n'en portent
// aucune. Ce test verrouille ces valeurs pour prouver que le correctif /admin
// n'a rien modifié d'autre — toute dérive future est détectée.
const GLOBAL_DEFAULT_MEMBER_PERMISSIONS = Object.freeze({
  analytics: "32",
  analytics_invites: undefined,
  analytics_xp: undefined,
  automod: "32",
  bannir: "4",
  captcha: "32",
  debannir: "4",
  deverrouiller: "16",
  expulser: "2",
  giveaway: "32",
  invites: undefined,
  mute: "1099511627776",
  pseudo: "134217728",
  settings: "32",
  slowmode: "16",
  suggest: undefined,
  supprimer: "8192",
  ticketpanel: "32",
  unmute: "1099511627776",
  uploadsticker: "32",
  verrouiller: "16",
  warn: "1099511627776",
});

test("les 22 commandes globales ne sont pas affectées par ce correctif", () => {
  const plan = prepareDeploymentPlan(commandHandler.loadCommands());
  assert.equal(plan.global.length, 22);
  for (const command of plan.global) {
    assert.deepEqual(command.contexts, [0], `/${command.name} reste guild-only`);
    assert.ok(command.name in GLOBAL_DEFAULT_MEMBER_PERMISSIONS,
      `/${command.name} absente de la photographie attendue`);
    assert.equal(command.default_member_permissions, GLOBAL_DEFAULT_MEMBER_PERMISSIONS[command.name],
      `/${command.name} : default_member_permissions inattendu`);
  }
  // /admin est désormais la seule commande portant Administrator (8).
  const all = [...plan.global, ...plan.technical];
  assert.deepEqual(
    all.filter((command) => command.default_member_permissions === ADMINISTRATOR_BITFIELD).map((c) => c.name),
    ["admin"],
  );
});
