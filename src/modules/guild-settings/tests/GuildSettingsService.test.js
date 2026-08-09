"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ValidationError } = require("../../../core/errors");
const { GuildSettingsService } = require("../services/GuildSettingsService");

test("GuildSettingsService reads and writes language only through the resolver contract", async () => {
  const calls = [];
  const resolver = {
    getLanguage: async () => "fr",
    update: async (id, patch) => { calls.push({ id, patch }); return patch; },
  };
  const service = new GuildSettingsService({ guildConfigResolver: resolver });
  assert.equal(await service.getLanguage("guild"), "fr");
  assert.deepEqual(await service.updateLanguage("guild", "en"), { language: "en" });
  assert.deepEqual(calls, [{ id: "guild", patch: { language: "en" } }]);
  await assert.rejects(() => service.updateLanguage("guild", "de"), ValidationError);
});
