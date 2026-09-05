"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("analytics wiring in messageCreate and guildMemberAdd is isolated and non-blocking", () => {
  const msgCreate = fs.readFileSync("src/events/messageCreate.js", "utf8");
  assert.match(msgCreate, /getAnalyticsRuntime/);
  assert.match(msgCreate, /trackMessage/);
  const memberAdd = fs.readFileSync("src/events/guildMemberAdd.js", "utf8");
  assert.match(memberAdd, /getAnalyticsRuntime/);
  assert.match(memberAdd, /trackMember/);
  // Both in try/catch
  assert.ok((msgCreate.match(/try/g) || []).length >= 3);

  // Phase 1 : l'ancienne assertion était `(memberAdd.match(/try/g) || []).length >= 5`.
  // C'était un proxy syntaxique, pas une vérification d'intention : retirer une
  // fonction morte contenant un try/catch (handleJoinLog, jamais appelée) la
  // faisait échouer alors que l'isolation réelle des branches non critiques
  // était intacte. On asserte désormais cette intention directement : chaque
  // branche non critique de guildMemberAdd est enveloppée dans son propre try.
  const isolatedBranches = [
    ["guild config service require", /try \{\n {2}guildConfigService = require\("\.\.\/services\/guildConfig"\)/],
    ["security runtime", /try \{\n +await require\("\.\.\/modules\/security\/runtime\/getSecurityRuntime"\)/],
    ["analytics runtime", /try \{\n +await require\("\.\.\/modules\/analytics\/runtime\/getAnalyticsRuntime"\)/],
  ];
  for (const [label, pattern] of isolatedBranches) {
    assert.match(memberAdd, pattern, `member add must isolate ${label} in its own try/catch`);
  }
});

test("analytics wiring does not break AutoMod/XP/Security", async () => {
  const { createAnalyticsRuntime } = require("../runtime/createAnalyticsRuntime");
  const runtime = createAnalyticsRuntime({
    configService: { read: async () => ({ analytics_enabled: true }) },
    analyticsRepository: { track: async () => { throw new Error("fail"); }, getStats: async () => ({ messages: 0, members: 0 }), getEvents: async () => [] },
  });
  let threw = false;
  try {
    await runtime.trackMessage({ guild: { id: "g" }, author: { id: "u", bot: false } });
    await runtime.trackMember({ guild: { id: "g" }, id: "u" });
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
});
