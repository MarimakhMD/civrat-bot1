"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ConfigurationError, ValidationError } = require("../../src/core/errors");
const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../src/core/guild-config");
const { createFakeConfigRepository } = require("../../src/core/testing/fakeConfigRepository");

test("guild configuration resolver delegates through an injected repository", async () => {
  const repository = createFakeConfigRepository({ guild: { language: "en", welcome_enabled: true } });
  const resolver = new GuildConfigResolver({ repository });
  assert.deepEqual(await resolver.get("guild"), { language: "en", welcome_enabled: true });
  assert.equal(await resolver.getLanguage("guild"), "en");
  await resolver.invalidate("guild");
  assert.deepEqual(repository.invalidated, ["guild"]);
});

test("guild configuration resolver validates input and wraps unavailable configuration", async () => {
  const resolver = new GuildConfigResolver({ repository: createFakeConfigRepository() });
  await assert.rejects(() => resolver.get(""), ValidationError);
  await assert.rejects(() => resolver.get("missing"), ConfigurationError);
});

test("legacy repository is a dependency-injected adapter", async () => {
  const invalidated = [];
  const repository = new LegacyGuildConfigRepository({
    getConfig: async (guildId) => ({ guildId, language: "fr" }),
    updateConfig: async (guildId, updates) => ({ guildId, ...updates }),
    invalidateConfig: async (guildId) => invalidated.push(guildId),
  });
  assert.deepEqual(await repository.getByGuildId("guild"), { guildId: "guild", language: "fr" });
  assert.deepEqual(await repository.updateByGuildId("guild", { language: "en" }), { guildId: "guild", language: "en" });
  await repository.invalidate("guild");
  assert.deepEqual(invalidated, ["guild"]);
});


test("guild configuration resolver writes through its repository and invalidates once", async () => {
  const repository = createFakeConfigRepository({ guild: { language: "fr" } });
  const resolver = new GuildConfigResolver({ repository });
  assert.deepEqual(await resolver.update("guild", { language: "en" }), { language: "en" });
  assert.deepEqual(repository.updates, [{ guildId: "guild", patch: { language: "en" } }]);
  assert.deepEqual(repository.invalidated, ["guild"]);
  await assert.rejects(() => resolver.update("guild", {}), ValidationError);
});
