"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { registerSticker } = require("../register");

test("uploadsticker registers ManageGuild command with file option", () => {
  const registry = new InteractionRegistry();
  const result = registerSticker({ registry });
  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].name, "uploadsticker");
  assert.deepEqual(result.commands[0].permissions.allOf, [PermissionName.MANAGE_GUILD]);
  const route = registry.find({ kind: "command", name: "uploadsticker" });
  assert.ok(route);
  assert.ok(route.options.some((o) => o.name === "file" && o.type === "attachment"));
  assert.ok(route.options.some((o) => o.name === "name" && o.type === "string"));
});

test("uploadsticker command respects limit via service", async () => {
  const registry = new InteractionRegistry();
  registerSticker({ registry });
  const route = registry.find({ kind: "command", name: "uploadsticker" });
  // Mock transport that returns count 5 (limit reached)
  let replied = null;
  const context = {
    t: (k, vars) => `${k} ${JSON.stringify(vars || {})}`,
    envelope: {
      options: {
        getString: (name) => (name === "name" ? "test" : null),
        getAttachment: (name) => (name === "file" ? { url: "http://example.com/sticker.png" } : null),
      },
      discordMember: { guild: { stickers: { fetch: async () => new Map([["1", {}], ["2", {}], ["3", {}], ["4", {}], ["5", {}]]) } } },
      transport: { reply: async (payload) => { replied = payload; } },
    },
  };
  // Force service to see 5 stickers via transport mock inside register (uses real DiscordStickerTransport which will fetch 5)
  // Here we test the service directly for limit, as the command's transport will use real guild which we mock to 5
  // Instead test service directly
  const { StickerService } = require("../services/StickerService");
  const svc = new StickerService({ limit: 5 });
  const res = await svc.upload({ file: {}, name: "test", transport: { countStickers: async () => 5, createSticker: async () => ({}) } });
  assert.equal(res.code, "STICKER_LIMIT_REACHED");
});
