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
  assert.deepEqual(keys(adminCommand), [
    "contexts",
    "deploymentScope",
    "description",
    "integrationTypes",
    "name",
    "options",
    "permissions",
  ]);
});
