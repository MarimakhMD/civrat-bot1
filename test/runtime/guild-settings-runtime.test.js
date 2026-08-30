"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
const { getEntitlementService } = require("../../src/runtime/getEntitlementService");

function configService() {
  const config = { language: "fr" };
  return {
    getGuildConfig: async () => config,
    getGuildConfigState: async () => ({ config, available: true, found: true, source: "database" }),
    updateGuildConfig: async (_id, update) => Object.assign(config, update),
    invalidateCache: async () => {},
  };
}

test("Guild Settings runtime composes without concrete persistence", () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: configService() });
  assert.ok(runtime.getDiscordCommands().some(({ data }) => data.name === "settings"));
});

test("Guild Settings runtime shares the central EntitlementService with Tickets", () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: configService() });
  assert.equal(runtime.ticketPremiumResolver.entitlementService, getEntitlementService());
});
