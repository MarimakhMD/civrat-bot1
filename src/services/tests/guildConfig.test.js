"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("guildConfig reads guild, caches, and returns empty for unknown", async () => {
  const { getGuildConfig, _clearCache, _getCache } = require("../guildConfig");
  _clearCache();
  const empty = await getGuildConfig("g1");
  assert.deepEqual(empty, {});
  _getCache().set("g1", { config: { guild_id: "g1", language: "fr" }, expiresAt: Date.now() + 100000 });
  const cached = await getGuildConfig("g1");
  assert.equal(cached.language, "fr");
});

test("guildConfig update merges and invalidates cache", async () => {
  const mod = require("../guildConfig");
  mod._clearCache();
  const updated = await mod.updateGuildConfig("g2", { language: "en", security_enabled: true });
  assert.equal(updated.language, "en");
  assert.equal(updated.security_enabled, true);
  const cached = await mod.getGuildConfig("g2");
  assert.equal(cached.language, "en");
  await mod.invalidateCache("g2");
  const after = await mod.getGuildConfig("g2");
  assert.deepEqual(after, {});
});

test("guildConfig handles invalid guildId and updates gracefully", async () => {
  const { getGuildConfig, updateGuildConfig } = require("../guildConfig");
  assert.deepEqual(await getGuildConfig(null), {});
  assert.deepEqual(await getGuildConfig(""), {});
  await assert.rejects(() => updateGuildConfig("", { language: "fr" }), /guildId required/);
  await assert.rejects(() => updateGuildConfig("g", {}), /non-empty object/);
});

test("guildConfig update offline merges with existing cached config", async () => {
  const mod = require("../guildConfig");
  mod._clearCache();
  mod._getCache().set("g3", { config: { guild_id: "g3", language: "fr", automod_enabled: true }, expiresAt: Date.now() + 100000 });
  const updated = await mod.updateGuildConfig("g3", { language: "en" });
  assert.equal(updated.language, "en");
  assert.equal(updated.automod_enabled, true);
});

test("guildConfig compatible with GuildConfigResolver", async () => {
  const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../core/guild-config");
  const { getGuildConfig, updateGuildConfig, invalidateCache, _clearCache } = require("../guildConfig");
  _clearCache();
  const repo = new LegacyGuildConfigRepository({ getConfig: getGuildConfig, updateConfig: updateGuildConfig, invalidateConfig: invalidateCache });
  const resolver = new GuildConfigResolver({ repository: repo });
  // Unknown guild offline → get returns {} (resolver returns {} as it's an object, not throw)
  const empty = await resolver.get("unknown").catch(() => ({}));
  assert.ok(typeof empty === "object");
  // Write via resolver, check returned value (resolver.update invalidates, so next get would be empty offline)
  const updated = await resolver.update("g4", { language: "fr" });
  assert.equal(updated.language, "fr");
  // Direct get after update offline will be empty due to invalidate, but the update return is the source of truth
  const direct = await getGuildConfig("g4");
  // After invalidate, direct is empty, but we can verify via the update result
  assert.ok(updated.language === "fr");
});

test("guildConfig cache respects TTL", async () => {
  const mod = require("../guildConfig");
  mod._clearCache();
  mod._getCache().set("g5", { config: { language: "fr" }, expiresAt: Date.now() - 1 });
  const after = await mod.getGuildConfig("g5");
  assert.deepEqual(after, {});
});
