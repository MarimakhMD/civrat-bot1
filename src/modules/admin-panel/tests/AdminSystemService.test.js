"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AdminSystemService } = require("../services/AdminSystemService");

const technicalConfig = {
  guildId: "1320817768962064384",
  channelId: "1542957356382552154",
  roleId: "1542958959907053688",
};

function service({
  snapshot = { config: {}, available: true, found: true, source: "database" },
  entitlementService = { listPremiumServers: async () => [] },
} = {}) {
  return new AdminSystemService({
    technicalConfig,
    configurationReader: async () => snapshot,
    entitlementService,
    now: () => 10_000,
    startedAt: 4_000,
  });
}

test("lists only guild data genuinely present in the Discord cache", () => {
  const cache = new Map([
    ["2", { id: "2", name: "Zulu", memberCount: 12 }],
    ["1", { id: "1", name: "Alpha" }],
  ]);
  const result = service().listInstalledGuilds({ guilds: { cache } });
  assert.equal(result.available, true);
  assert.equal(result.total, 2);
  assert.deepEqual(result.guilds, [
    { id: "1", name: "Alpha", memberCount: null },
    { id: "2", name: "Zulu", memberCount: 12 },
  ]);
  assert.deepEqual(service().listInstalledGuilds(null), { available: false, guilds: [], total: null });
});

test("technical configuration exposes public IDs and exactly 13 feature states", async () => {
  const result = await service({
    snapshot: {
      config: {
        language: "fr",
        tickets_enabled: true,
        ticket_category_id: "category",
        ticket_support_role_id: "role",
      },
      available: true,
      found: true,
      source: "database",
    },
  }).getTechnicalConfiguration();
  assert.deepEqual(result.technical, technicalConfig);
  assert.equal(result.guild.features.length, 13);
  assert.deepEqual(result.guild.features.find(({ id }) => id === "tickets").state, {
    enabled: true,
    configured: true,
  });
});

test("diagnostics preserve unavailable backends without invented counts", async () => {
  const broken = service({
    snapshot: { config: {}, available: false, found: false, source: "unavailable" },
    entitlementService: { listPremiumServers: async () => { throw new Error("offline"); } },
  });
  const diagnostics = await broken.getDiagnostics(null);
  assert.equal(diagnostics.runtime.uptimeSeconds, 6);
  assert.equal(diagnostics.discord.available, false);
  assert.equal(diagnostics.discord.installedGuilds, null);
  assert.deepEqual(diagnostics.configuration, { available: false, source: "unavailable" });
  assert.deepEqual(diagnostics.entitlements, { available: false, records: null });
});
