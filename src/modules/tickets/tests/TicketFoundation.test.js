"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { TicketConfigService } = require("../services/TicketConfigService");
const { TicketPermissionService } = require("../services/TicketPermissionService");
const { TicketTranscriptService } = require("../services/TicketTranscriptService");

test("ticket foundation uses resolver and transport-neutral contracts", async () => {
  let config = { tickets_enabled: false };
  const service = new TicketConfigService({
    guildConfigResolver: {
      get: async () => config,
      update: async (_guildId, updates) => { config = { ...config, ...updates }; return config; },
    },
  });
  await service.update("g", { tickets_enabled: true, ticket_category_id: "c", ticket_support_role_id: "r" });
  assert.equal(config.tickets_enabled, true);
  assert.equal(new TicketPermissionService().canManage({ isOwner: false, isSupport: true }), true);
  assert.match(new TicketTranscriptService().build([{ timestamp: "t", author: "u", content: "x" }]), /x/);
});
