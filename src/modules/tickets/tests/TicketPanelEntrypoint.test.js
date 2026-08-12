"use strict";

// P12.2 (B1) — l'entrypoint garde le customId de création stable et envoie la
// vue dans le salon fourni par l'appelant.

const test = require("node:test");
const assert = require("node:assert/strict");
const { TicketPanelDeliveryService } = require("../services/TicketPanelDeliveryService");

test("new ticket panel delivery preserves stable create custom id", async () => {
  let sent;
  let sentTo = null;
  const service = new TicketPanelDeliveryService({
    panelService: {
      build: async () => ({
        ready: true,
        view: { components: [{ customId: "civrat:v1:tickets:create" }] },
      }),
    },
    transport: {
      sendPanel: async (channelId, view) => { sentTo = channelId; sent = view; },
    },
  });
  const result = await service.deliver("g", (key) => key, "interaction-channel");
  assert.equal(result.delivered, true);
  assert.equal(sentTo, "interaction-channel");
  assert.equal(sent.components[0].customId, "civrat:v1:tickets:create");
});
