"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { toDiscordCommand } = require("../../../src/adapters/discord");
const { PermissionName } = require("../../../src/core/permissions");

test("Discord command adapter maps a neutral command definition", () => {
  const command = toDiscordCommand(
    { name: "settings", description: "⚙️ CIVRAT", permissions: { allOf: [PermissionName.MANAGE_GUILD] } },
    async () => {}
  );
  assert.equal(command.data.name, "settings");
  assert.equal(command.data.description, "⚙️ CIVRAT");
  assert.equal(typeof command.execute, "function");
});

test("commands are guild-only by default (contexts = [Guild])", () => {
  const command = toDiscordCommand(
    { name: "settings", description: "⚙️ CIVRAT", permissions: { allOf: [PermissionName.MANAGE_GUILD] } },
    async () => {}
  );
  assert.deepEqual(command.data.toJSON().contexts, [0], "default exposure is Guild only");
});

test("explicit contexts guild + botDm are mapped to [0, 1]", () => {
  const command = toDiscordCommand(
    {
      name: "ownerpanel",
      description: "Panel",
      permissions: { allOf: [] },
      contexts: ["guild", "botDm"],
      integrationTypes: ["guildInstall", "userInstall"],
      defaultMemberPermissions: PermissionName.ADMINISTRATOR,
    },
    async () => {}
  );
  const json = command.data.toJSON();
  assert.deepEqual(json.contexts, [0, 1]);
  assert.deepEqual(json.integration_types, [0, 1], "DM requires user install");
  assert.equal(json.default_member_permissions, "8", "Administrator by default on servers");
});

test("attachment option is mapped as a Discord Attachment (type 11, required)", () => {
  const command = toDiscordCommand(
    {
      name: "uploadsticker",
      description: "Upload a sticker",
      permissions: { allOf: [PermissionName.MANAGE_GUILD] },
      options: [
        { type: "string", name: "name", description: "Sticker name (2-30)", required: true },
        { type: "attachment", name: "file", description: "Sticker file (png/jpeg/gif)", required: true },
      ],
    },
    async () => {}
  );
  const json = command.data.toJSON();
  const file = json.options.find((o) => o.name === "file");
  assert.ok(file, "file option must be present");
  assert.equal(file.type, 11, "ApplicationCommandOptionType.Attachment");
  assert.equal(file.required, true, "attachment must stay required");
  const name = json.options.find((o) => o.name === "name");
  assert.equal(name.type, 3, "string option untouched");
  assert.deepEqual(json.contexts, [0], "uploadsticker is guild-only");
});

test("explicit defaultMemberPermissions wins over permissions.allOf fallback", () => {
  const command = toDiscordCommand(
    {
      name: "recovery",
      description: "Recovery",
      permissions: { allOf: [] }, // public at runtime
      defaultMemberPermissions: PermissionName.ADMINISTRATOR,
    },
    async () => {}
  );
  assert.equal(command.data.toJSON().default_member_permissions, "8");
});
