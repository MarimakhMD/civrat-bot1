"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("security wiring: events use modern Security runtime and not legacy securityService", () => {
  const memberAdd = fs.readFileSync("src/events/guildMemberAdd.js", "utf8");
  assert.match(memberAdd, /getSecurityRuntime/);
  assert.match(memberAdd, /handleMemberJoined/);
  assert.doesNotMatch(memberAdd, /securityService\.recordRaidJoin/);
  assert.doesNotMatch(memberAdd, /securityService\.handleBotJoin/);
  assert.doesNotMatch(memberAdd, /require\("..\/services\/securityService"\)/);

  for (const file of ["src/events/channelCreate.js", "src/events/channelDelete.js"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /getSecurityRuntime/);
    assert.match(source, /handleChannel/);
    assert.doesNotMatch(source, /securityService\.recordNukeAction/);
    assert.doesNotMatch(source, /require\("..\/services\/securityService"\)/);
  }

  for (const file of ["src/events/roleCreate.js", "src/events/roleDelete.js"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /getSecurityRuntime/);
    assert.match(source, /handleRole/);
    assert.doesNotMatch(source, /securityService\.recordNukeAction/);
  }
});

test("security wiring: no legacy securityService file reintroduced", () => {
  assert.equal(fs.existsSync("src/services/securityService.js"), false);
});

test("security wiring: guildMemberAdd remains non-blocking on Security failure", async () => {
  // Simulate Security runtime that throws — test via runtime directly, not event file (which requires discord.js)
  const { createSecurityRuntime } = require("../runtime/createSecurityRuntime");
  const runtime = createSecurityRuntime({
    configService: { read: async () => ({ security_enabled: true, security_anti_raid: true }) },
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async () => { throw new Error("security fail"); } }),
  });
  let threw = false;
  try {
    await runtime.handleMemberJoined({ guild: { id: "g" }, id: "u1", user: { bot: false } });
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
});

test("security wiring: channel/role events are non-blocking on Security failure", async () => {
  const { createSecurityRuntime } = require("../runtime/createSecurityRuntime");
  const runtime = createSecurityRuntime({
    configService: { read: async () => ({ security_enabled: true, security_anti_nuke: true }) },
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async () => { throw new Error("fail"); } }),
  });
  let threw = false;
  try {
    await runtime.handleChannelCreate({ guild: { id: "g" } });
    await runtime.handleChannelDelete({ guild: { id: "g" } });
    await runtime.handleRoleCreate({ guild: { id: "g" }, id: "r1" });
    await runtime.handleRoleDelete({ guild: { id: "g" }, id: "r1" });
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
});

test("security wiring: no double execution legacy/moderne", () => {
  const files = ["src/events/guildMemberAdd.js", "src/events/channelCreate.js", "src/events/channelDelete.js", "src/events/roleCreate.js", "src/events/roleDelete.js"];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    // Only count actual code, not comments mentioning legacy (the comment "no legacy securityService" would otherwise trigger)
    const legacyCount = (source.match(/securityService\./g) || []).length + (source.match(/require\("..\/services\/securityService"\)/g) || []).length;
    const modernCount = (source.match(/getSecurityRuntime/g) || []).length;
    assert.equal(legacyCount, 0, `${file} should have 0 legacy securityService calls`);
    assert.ok(modernCount >= 1, `${file} should have at least 1 modern getSecurityRuntime`);
  }
});
