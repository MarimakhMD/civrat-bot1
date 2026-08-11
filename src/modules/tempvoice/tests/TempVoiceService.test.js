"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TempVoiceService } = require("../services/TempVoiceService");

test("handleJoin creates temp channel when joining lobby", async () => {
  let created = null, moved = null;
  const transport = {
    createChannel: async ({ name, parentId, userId }) => { created = { name, parentId, userId }; return { id: "temp1" }; },
    moveMember: async (member, channelId) => { moved = channelId; },
    isEmpty: async () => true,
    deleteChannel: async () => true,
  };
  const config = { tempvoice_enabled: true, tempvoice_lobby_channel_id: "lobby", tempvoice_category_id: "cat" };
  const svc = new TempVoiceService({ transport, config, tempChannels: new Set() });
  const res = await svc.handleJoin({ member: { id: "u1", user: { username: "bob" } }, channelId: "lobby" });
  assert.equal(res.handled, true);
  assert.equal(res.code, "TEMPVOICE_CREATED");
  assert.equal(created.name, "bob's room");
  assert.equal(created.parentId, "cat");
  assert.equal(moved, "temp1");
  assert.ok(svc.isTempChannel("temp1"));
});

test("handleJoin ignores when disabled or not lobby", async () => {
  const transport = { createChannel: async () => ({ id: "x" }), moveMember: async () => {} };
  const svcDisabled = new TempVoiceService({ transport, config: { tempvoice_enabled: false, tempvoice_lobby_channel_id: "lobby" } });
  assert.equal((await svcDisabled.handleJoin({ member: { id: "u1", user: { username: "bob" } }, channelId: "lobby" })).code, "TEMPVOICE_DISABLED");
  const svc = new TempVoiceService({ transport, config: { tempvoice_enabled: true, tempvoice_lobby_channel_id: "lobby" } });
  assert.equal((await svc.handleJoin({ member: { id: "u1", user: { username: "bob" } }, channelId: "other" })).code, "NOT_LOBBY");
});

test("handleLeave deletes temp when empty", async () => {
  let deleted = null;
  const transport = {
    isEmpty: async (id) => id === "temp1",
    deleteChannel: async (id) => { deleted = id; },
    createChannel: async () => ({ id: "x" }),
    moveMember: async () => {},
  };
  const config = { tempvoice_enabled: true };
  const svc = new TempVoiceService({ transport, config, tempChannels: new Set(["temp1", "temp2"]) });
  const res = await svc.handleLeave({ channelId: "temp1" });
  assert.equal(res.handled, true);
  assert.equal(deleted, "temp1");
  assert.equal(svc.isTempChannel("temp1"), false);
  const res2 = await svc.handleLeave({ channelId: "temp2" });
  // temp2 is not empty (mock returns false for temp2)
  assert.equal(res2.code, "TEMPVOICE_NOT_EMPTY");
});

test("handleLeave ignores non-temp channels", async () => {
  const transport = { isEmpty: async () => true, deleteChannel: async () => {} };
  const svc = new TempVoiceService({ transport, config: { tempvoice_enabled: true }, tempChannels: new Set(["temp1"]) });
  assert.equal((await svc.handleLeave({ channelId: "other" })).code, "NOT_TEMP");
});
