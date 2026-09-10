"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { handleMessageDeleted } = require("../events/handleMessageDeleted");
const { handleMessageUpdated } = require("../events/handleMessageUpdated");
const { handleMemberLeft } = require("../events/handleMemberLeft");
const { LogsDeliveryService } = require("../services/LogsDeliveryService");
const { LogsEventMapper } = require("../services/LogsEventMapper");
const { LogsService } = require("../services/LogsService");

function makeDeps(config = {}) {
  const mapper = new LogsEventMapper();
  const service = new LogsService();
  const delivered = [];
  const delivery = {
    deliver: async (entry) => {
      delivered.push(entry);
      return { delivered: true, reason: null, details: {} };
    },
  };
  return { config, mapper, service, delivery, delivered };
}

const ENABLED = {
  logs_enabled: true,
  log_message_delete_channel_id: "LOGCH",
  log_message_edit_channel_id: "LOGCH",
  log_member_leave_channel_id: "LOGCH",
};

// ───────────────────────────────────────────────────────────────
// P0.2 — messages partiels : on logue sans inventer d'informations.
// ───────────────────────────────────────────────────────────────

test("handleMessageDeleted logue un message complet avec son auteur", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps(ENABLED);
  const message = { guild: { id: "G" }, id: "MSG", channelId: "CH", author: { id: "A", bot: false } };
  const result = await handleMessageDeleted({ message, config, mapper, service, delivery });
  assert.equal(result.delivered, true);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].details.authorId, "A");
  assert.equal(delivered[0].details.messageId, "MSG");
  assert.equal(delivered[0].channelId, "LOGCH");
});

test("handleMessageDeleted logue un message partiel (author null) sans fabriquer d'auteur", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps(ENABLED);
  const message = { guild: { id: "G" }, id: "MSG", channelId: "CH", author: null };
  const result = await handleMessageDeleted({ message, config, mapper, service, delivery });
  assert.equal(result.delivered, true);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].details.messageId, "MSG");
  assert.equal(delivered[0].details.channelId, "CH");
  assert.equal(delivered[0].details.authorId, null);
});

test("handleMessageDeleted ignore les messages de bots (auteur connu)", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps(ENABLED);
  const message = { guild: { id: "G" }, id: "MSG", channelId: "CH", author: { id: "A", bot: true } };
  const result = await handleMessageDeleted({ message, config, mapper, service, delivery });
  assert.equal(result, null);
  assert.equal(delivered.length, 0);
});

test("handleMessageUpdated logue un message partiel sans lever", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps(ENABLED);
  const message = { guild: { id: "G" }, id: "MSG", channelId: "CH", author: null };
  const result = await handleMessageUpdated({ message, config, mapper, service, delivery });
  assert.equal(result.delivered, true);
  assert.equal(delivered[0].details.messageId, "MSG");
  assert.equal(delivered[0].details.authorId, null);
});

// ───────────────────────────────────────────────────────────────
// P0.3 — membre partiel au départ.
// ───────────────────────────────────────────────────────────────

test("handleMemberLeft logue un membre partiel (user null) sans lever", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps(ENABLED);
  const member = { guild: { id: "G" }, id: "M", user: null };
  const result = await handleMemberLeft({ member, config, mapper, service, delivery });
  assert.equal(result.delivered, true);
  assert.equal(delivered[0].details.memberId, "M");
});

test("handleMemberLeft ignore les bots (user connu)", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps(ENABLED);
  const member = { guild: { id: "G" }, id: "M", user: { bot: true } };
  const result = await handleMemberLeft({ member, config, mapper, service, delivery });
  assert.equal(result, null);
  assert.equal(delivered.length, 0);
});

// ───────────────────────────────────────────────────────────────
// P2.1 — observabilité des échecs de livraison.
// ───────────────────────────────────────────────────────────────

test("LogsDeliveryService livre avec succès", async () => {
  const service = new LogsDeliveryService({ transport: { deliver: async () => {} } });
  const result = await service.deliver({ channelId: "C", category: "messages", action: "x" });
  assert.equal(result.delivered, true);
});

test("LogsDeliveryService journalise l'échec de transport", async () => {
  const warnings = [];
  const logger = { warn: (msg, meta) => warnings.push({ msg, meta }) };
  const service = new LogsDeliveryService({
    transport: { deliver: async () => { throw new Error("boom"); } },
    logger,
  });
  const result = await service.deliver({ channelId: "C", category: "messages", action: "message_deleted" });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "LOG_TRANSPORT_FAILED");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].meta.channelId, "C");
  assert.equal(warnings[0].meta.action, "message_deleted");
});

test("LogsDeliveryService sans logger n'échoue pas silencieusement à tort (retour explicite)", async () => {
  const service = new LogsDeliveryService({ transport: { deliver: async () => { throw new Error("boom"); } } });
  const result = await service.deliver({ channelId: "C" });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "LOG_TRANSPORT_FAILED");
});

test("LogsDeliveryService signale un salon non configuré", async () => {
  const warnings = [];
  const logger = { warn: (msg, meta) => warnings.push({ msg, meta }) };
  const service = new LogsDeliveryService({ transport: { deliver: async () => {} }, logger });
  const result = await service.deliver({ category: "messages", action: "x" });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "LOG_CHANNEL_NOT_CONFIGURED");
  assert.equal(warnings.length, 1);
});
