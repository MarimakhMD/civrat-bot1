"use strict";

// P12.2 (B1) — contrat de livraison : la destination est le salon texte fourni
// par l'appelant, jamais la catégorie de configuration.

const test = require("node:test");
const assert = require("node:assert/strict");
const { TicketPanelDeliveryService } = require("../services/TicketPanelDeliveryService");

const view = { title: "t", content: "d", components: [{ customId: "civrat:v1:tickets:create", label: "create" }] };

test("ticket panel delivery sends once to the caller-provided text channel when ready", async () => {
  let sentTo = null;
  let calls = 0;
  const service = new TicketPanelDeliveryService({
    panelService: { build: async () => ({ ready: true, view }) },
    transport: { sendPanel: async (channelId) => { calls += 1; sentTo = channelId; } },
  });
  const result = await service.deliver("g", (k) => k, "text-channel-1");
  assert.equal(result.delivered, true);
  assert.equal(result.channelId, "text-channel-1");
  assert.equal(calls, 1);
  assert.equal(sentTo, "text-channel-1");
});

test("ticket panel delivery refuses a missing destination (never falls back to any category)", async () => {
  let calls = 0;
  const service = new TicketPanelDeliveryService({
    panelService: { build: async () => ({ ready: true, view }) },
    transport: { sendPanel: async () => { calls += 1; } },
  });
  const result = await service.deliver("g", (k) => k, null);
  assert.equal(result.delivered, false);
  assert.equal(result.code, "CHANNEL_UNAVAILABLE");
  assert.equal(calls, 0, "no destination must mean no send attempt");
});

test("ticket panel delivery skips incomplete configuration", async () => {
  let calls = 0;
  const service = new TicketPanelDeliveryService({
    panelService: { build: async () => ({ ready: false, code: "TICKET_CONFIG_INCOMPLETE" }) },
    transport: { sendPanel: async () => { calls += 1; } },
  });
  assert.equal((await service.deliver("g", (k) => k, "text-channel-1")).delivered, false);
  assert.equal(calls, 0);
});

test("ticket panel delivery reports TRANSPORT_ERROR when the transport rejects the channel", async () => {
  const service = new TicketPanelDeliveryService({
    panelService: { build: async () => ({ ready: true, view }) },
    transport: { sendPanel: async () => { throw new Error("channel_unavailable"); } },
  });
  const result = await service.deliver("g", (k) => k, "cat-not-text");
  assert.equal(result.delivered, false);
  assert.equal(result.code, "TRANSPORT_ERROR");
});
