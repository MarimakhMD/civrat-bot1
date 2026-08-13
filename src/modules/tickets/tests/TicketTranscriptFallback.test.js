"use strict";

// P13 (B3) — destination des transcripts à la fermeture : override Premium
// 10.3 quand l'entitlement est actif, fallback Free ticket_log_channel_id
// sinon (réactivé et configurable depuis /settings), transcript sauté proprement
// quand aucune destination n'est configurée (sémantique existante conservée).

const test = require("node:test");
const assert = require("node:assert/strict");
const { TicketService } = require("../services/TicketService");
const { TicketPremiumConfigResolver } = require("../services/TicketPremiumConfigResolver");
const { EntitlementService } = require("../../../core/entitlements");

const ACTIVE = { status: "active", ends_at: null };
const REVOKED = { status: "revoked", ends_at: null };

function makeResolver(record) {
  return new TicketPremiumConfigResolver({ entitlementService: new EntitlementService({ repository: { findFeature: async () => record } }) });
}

function createCloseService({ config = {}, record = undefined, ticketLog = null } = {}) {
  const deliveries = [];
  const service = new TicketService({
    repository: {
      findByChannel: async () => ({ guild_id: "guild", channel_id: "channel", user_id: "creator", status: "open", closed: false }),
      updateByChannel: async (_c, value) => value,
    },
    configService: { read: async () => ({ tickets_enabled: true, ticket_category_id: "category", ticket_support_role_id: "support", ...config }) },
    transport: {
      isMemberInRole: async () => false,
      closeTicketChannel: async () => ({ closed: true }),
    },
    transcriptService: { deliver: async (args) => { deliveries.push(args); return { delivered: Boolean(args.logChannelId) }; } },
    premiumConfigResolver: record === undefined ? null : makeResolver(record),
    ticketLog,
  });
  return { service, deliveries };
}

const closeInput = { guildId: "guild", channelId: "channel", member: { id: "creator" } };

test("Free: the configured log channel receives the transcript destination", async () => {
  const { service, deliveries } = createCloseService({ config: { ticket_log_channel_id: "111111111111111111" } });
  const result = await service.closeTicket(closeInput);
  assert.equal(result.code, "TICKET_CLOSED");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].logChannelId, "111111111111111111");
  assert.equal(deliveries[0].channelId, "channel");
});

test("Free without a configured log channel: transcript is skipped cleanly (no crash, close still succeeds)", async () => {
  const { service, deliveries } = createCloseService({});
  const result = await service.closeTicket(closeInput);
  assert.equal(result.code, "TICKET_CLOSED");
  assert.equal(deliveries.length, 1);
  assert.ok(!deliveries[0].logChannelId, "existing semantic: no configured destination means the transcript service receives none (TRANSCRIPT_DESTINATION_MISSING)");
});

test("active Premium transcript channel overrides the Free one", async () => {
  const { service, deliveries } = createCloseService({
    config: { ticket_log_channel_id: "111111111111111111", ticket_transcript_channel_id: "222222222222222222" },
    record: ACTIVE,
  });
  const result = await service.closeTicket(closeInput);
  assert.equal(result.code, "TICKET_CLOSED");
  assert.equal(deliveries[0].logChannelId, "222222222222222222");
});

test("revoked Premium falls immediately back to the Free destination", async () => {
  const { service, deliveries } = createCloseService({
    config: { ticket_log_channel_id: "111111111111111111", ticket_transcript_channel_id: "222222222222222222" },
    record: REVOKED,
  });
  const result = await service.closeTicket(closeInput);
  assert.equal(result.code, "TICKET_CLOSED");
  assert.equal(deliveries[0].logChannelId, "111111111111111111", "no Premium leak after revocation");
});

test("premium keys without any entitlement record keep the Free destination", async () => {
  const { service, deliveries } = createCloseService({
    config: { ticket_log_channel_id: "111111111111111111", ticket_transcript_channel_id: "222222222222222222" },
    record: null,
  });
  const result = await service.closeTicket(closeInput);
  assert.equal(result.code, "TICKET_CLOSED");
  assert.equal(deliveries[0].logChannelId, "111111111111111111");
});
