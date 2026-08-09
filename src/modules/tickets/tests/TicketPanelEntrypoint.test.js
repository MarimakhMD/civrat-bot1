"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { TicketPanelDeliveryService } = require("../services/TicketPanelDeliveryService");

test("new ticket panel delivery preserves stable create custom id", async () => {
  let sent;
  const service = new TicketPanelDeliveryService({
    panelService: {
      build: async () => ({
        ready: true,
        channelId: "c",
        view: { components: [{ customId: "civrat:v1:tickets:create" }] },
      }),
    },
    transport: {
      sendPanel: async (_channelId, view) => { sent = view; },
    },
  });
  const result = await service.deliver("g", (key) => key);
  assert.equal(result.delivered, true);
  assert.equal(sent.components[0].customId, "civrat:v1:tickets:create");
});
