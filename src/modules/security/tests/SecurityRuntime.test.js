"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSecurityRuntime } = require("../runtime/createSecurityRuntime");

function configFor(overrides) {
  return { read: async () => ({ security_enabled: true, security_anti_raid: true, security_anti_bot: true, security_whitelist: [], security_anti_nuke: true, ...overrides }) };
}

function member(guildId, userId, isBot = false) {
  return { id: userId, guild: { id: guildId }, user: { bot: isBot } };
}

function channel(guildId) {
  return { guild: { id: guildId } };
}

function role(guildId) {
  return { guild: { id: guildId } };
}

test("raid detects 5 joins in 15s and logs", async () => {
  const logs = [];
  const runtime = createSecurityRuntime({
    configService: configFor({}),
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => logs.push(e) }),
  });
  for (let i = 0; i < 4; i++) {
    const res = await runtime.handleMemberJoined(member("g1", `u${i}`));
    assert.equal(res.raid.isRaid, false);
  }
  const res = await runtime.handleMemberJoined(member("g1", "u4"));
  assert.equal(res.raid.isRaid, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "security_raid");
  assert.equal(logs[0].rule, "SECURITY_RAID");
});

test("bot whitelist allows and blocks correctly and logs", async () => {
  const logs = [];
  const runtime = createSecurityRuntime({
    configService: configFor({ security_whitelist: ["111"] }),
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => logs.push(e) }),
  });
  const allowed = await runtime.handleMemberJoined(member("g1", "111", true));
  assert.equal(allowed.bot.allowed, true);
  assert.equal(logs.length, 0);
  const blocked = await runtime.handleMemberJoined(member("g1", "999", true));
  assert.equal(blocked.bot.allowed, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "security_bot");
  assert.equal(logs[0].targetId, "999");
});

test("nuke channel/role thresholds and logs", async () => {
  const logs = [];
  const runtime = createSecurityRuntime({
    configService: configFor({}),
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => logs.push(e) }),
  });
  for (let i = 0; i < 9; i++) {
    const r = await runtime.handleChannelCreate(channel("g1"));
    assert.equal(r.nuke.isNuke, false);
  }
  const nuke = await runtime.handleChannelCreate(channel("g1"));
  assert.equal(nuke.nuke.isNuke, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "security_nuke");
  // channelDelete 12
  logs.length = 0;
  for (let i = 0; i < 11; i++) await runtime.handleChannelDelete(channel("g2"));
  assert.equal(logs.length, 0);
  await runtime.handleChannelDelete(channel("g2"));
  assert.equal(logs.length, 1);
  // roleCreate 30
  logs.length = 0;
  for (let i = 0; i < 29; i++) await runtime.handleRoleCreate(role("g3"));
  assert.equal(logs.length, 0);
  await runtime.handleRoleCreate(role("g3"));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].rule, "SECURITY_NUKE_ROLE_CREATE");
});

test("security disabled or missing guild does not handle", async () => {
  const runtimeDisabled = createSecurityRuntime({ configService: configFor({ security_enabled: false }), logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async () => { throw new Error("should not log"); } }) });
  const res = await runtimeDisabled.handleMemberJoined(member("g1", "u1"));
  assert.equal(res.code, "SECURITY_DISABLED");
  const resNoGuild = await runtimeDisabled.handleMemberJoined({ id: "u1", guild: null });
  assert.equal(resNoGuild.code, "GUILD_MISSING");
  const ch = await runtimeDisabled.handleChannelCreate(channel("g1"));
  assert.equal(ch.code, "SECURITY_DISABLED");
});

test("logs disabled skips delivery and transport failure is best-effort", async () => {
  const runtimeLogsDisabled = createSecurityRuntime({
    configService: configFor({}),
    logsRuntimeFactory: () => ({ disabled: true, handleModerationEvent: async () => { throw new Error("should not call"); } }),
  });
  // need 5 joins to trigger raid, but logs disabled so no throw
  for (let i = 0; i < 5; i++) await runtimeLogsDisabled.handleMemberJoined(member("g1", `u${i}`));
  // should not throw, raid still detected
  const last = await runtimeLogsDisabled.handleMemberJoined(member("g1", "u5"));
  assert.equal(last.raid.isRaid, true);

  const runtimeThrows = createSecurityRuntime({
    configService: configFor({}),
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async () => { throw new Error("log fail"); } }),
  });
  for (let i = 0; i < 5; i++) await runtimeThrows.handleMemberJoined(member("g1", `v${i}`));
  // should not throw
  const res = await runtimeThrows.handleMemberJoined(member("g1", "v5"));
  assert.equal(res.raid.isRaid, true);
});

test("runtime handles non-bot joins without bot check side effects", async () => {
  const logs = [];
  const runtime = createSecurityRuntime({
    configService: configFor({}),
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => logs.push(e) }),
  });
  const res = await runtime.handleMemberJoined(member("g1", "u1", false));
  assert.ok(res.bot);
  assert.equal(res.bot.allowed, true);
  assert.equal(res.bot.reason, "NOT_A_BOT");
});
