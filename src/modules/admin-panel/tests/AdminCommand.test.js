"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CommandDeploymentScope } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { adminCommand } = require("../commands/adminCommand");

const keys = (value) => Object.keys(value).sort();

test("/admin is a technical guild-only command with no secret-bearing option", () => {
  assert.equal(adminCommand.name, "admin");
  assert.equal(adminCommand.deploymentScope, CommandDeploymentScope.CIVRAT_ADMIN_GUILD);
  assert.deepEqual(adminCommand.permissions, { allOf: [PermissionName.CIVRAT_ADMIN] });
  assert.deepEqual(adminCommand.contexts, ["guild"]);
  assert.deepEqual(adminCommand.integrationTypes, ["guildInstall"]);
  assert.deepEqual(adminCommand.options, []);
  // Phase 2 (P12) — visibilité Discord : sans ce champ, /admin était visible de
  // tous les membres de la guilde technique (CIVRAT_ADMIN est un rôle, absent de
  // discordPermissionMap, donc le repli permissions.allOf[0] ne produisait rien).
  // Le champ réduit la VISIBILITÉ ; l'autorisation reste la garde runtime
  // CIVRAT_ADMIN ci-dessus. Aucune option n'est ajoutée : la garde
  // « aucune option portant un secret » reste entière.
  assert.equal(adminCommand.defaultMemberPermissions, PermissionName.ADMINISTRATOR);
  assert.deepEqual(keys(adminCommand), [
    "contexts",
    "defaultMemberPermissions",
    "deploymentScope",
    "description",
    "integrationTypes",
    "name",
    "options",
    "permissions",
  ]);
});
