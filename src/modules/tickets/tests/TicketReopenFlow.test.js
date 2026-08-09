"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { DiscordTicketTransport } = require("../../../adapters/discord/DiscordTicketTransport");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { registerTickets } = require("../register");
const { TicketService } = require("../services/TicketService");

function createService({ ticket = { guild_id: "guild", channel_id: "channel", user_id: "creator", status: "closed", closed: true }, supportMember = false, findError = null, updateError = null, channelResult = { reopened: true } } = {}) {
  let reopenCalls = 0;
  let updateCalls = 0;
  let updates = null;
  const service = new TicketService({
    repository: {
      findByChannel: async () => { if (findError) throw findError; return ticket; },
      updateByChannel: async (_channelId, value) => { updateCalls += 1; updates = value; if (updateError) throw updateError; if (ticket) Object.assign(ticket, value); return ticket; },
    },
    configService: { read: async () => ({ ticket_support_role_id: "support" }) },
    transport: {
      isMemberInRole: async (member) => supportMember && member.id === "support-member",
      reopenTicketChannel: async () => { reopenCalls += 1; return channelResult; },
    },
  });
  return { service, get reopenCalls() { return reopenCalls; }, get updateCalls() { return updateCalls; }, get updates() { return updates; } };
}

const input = { guildId: "guild", channelId: "channel", member: { id: "creator" } };

test("ticket creator reopens a closed ticket and updates Supabase", async () => {
  const fixture = createService();
  const result = await fixture.service.reopenTicket(input);
  assert.equal(result.code, "TICKET_REOPENED");
  assert.equal(fixture.reopenCalls, 1);
  assert.deepEqual(fixture.updates, { status: "open", closed: false, closed_at: null });
});

test("support may reopen while unrelated members cannot", async () => {
  const support = createService({ supportMember: true });
  assert.equal((await support.service.reopenTicket({ ...input, member: { id: "support-member" } })).code, "TICKET_REOPENED");
  const unauthorized = createService();
  assert.equal((await unauthorized.service.reopenTicket({ ...input, member: { id: "other" } })).code, "TICKET_UNAUTHORIZED");
  assert.equal(unauthorized.reopenCalls, 0);
});

test("reopen rejects missing, open, deleted, and cross-guild tickets", async () => {
  assert.equal((await createService({ ticket: null }).service.reopenTicket(input)).code, "TICKET_NOT_FOUND");
  assert.equal((await createService({ ticket: { guild_id: "guild", user_id: "creator", status: "open", closed: false } }).service.reopenTicket(input)).code, "TICKET_ALREADY_OPEN");
  assert.equal((await createService({ ticket: { guild_id: "guild", user_id: "creator", status: "deleted", closed: true } }).service.reopenTicket(input)).code, "TICKET_ALREADY_DELETED");
  assert.equal((await createService({ ticket: { guild_id: "other", user_id: "creator", status: "closed", closed: true } }).service.reopenTicket(input)).code, "TICKET_GUILD_MISMATCH");
});

test("Discord and Supabase errors are structured and a ticket reopens once", async () => {
  assert.equal((await createService({ channelResult: { reopened: false, code: "TICKET_REOPEN_FAILED" } }).service.reopenTicket(input)).code, "TICKET_REOPEN_FAILED");
  assert.equal((await createService({ findError: new Error("select") }).service.reopenTicket(input)).code, "TICKET_REOPEN_FAILED");
  assert.equal((await createService({ updateError: new Error("update") }).service.reopenTicket(input)).code, "TICKET_REOPEN_FAILED");
  const fixture = createService();
  assert.equal((await fixture.service.reopenTicket(input)).code, "TICKET_REOPENED");
  assert.equal((await fixture.service.reopenTicket(input)).code, "TICKET_ALREADY_OPEN");
  assert.equal(fixture.reopenCalls, 1);
  assert.equal(fixture.updateCalls, 1);
});

test("Discord transport restores only creator SendMessages and keeps the channel", async () => {
  let overwrite;
  let deleted = false;
  const channel = { isTextBased: () => true, manageable: true, permissionOverwrites: { edit: async (...args) => { overwrite = args; } }, delete: async () => { deleted = true; } };
  const transport = new DiscordTicketTransport({ guild: { channels: { cache: new Map([["channel", channel]]) } } });
  assert.deepEqual(await transport.reopenTicketChannel("channel", "creator"), { reopened: true, code: "TICKET_CHANNEL_REOPENED" });
  assert.deepEqual(overwrite.slice(0, 2), ["creator", { SendMessages: true }]);
  assert.equal(deleted, false);
});

test("new reopen route is distinct while legacy and Claim routes remain unconsumed", () => {
  const registry = new InteractionRegistry();
  registerTickets({ registry, service: { read: async () => ({}) }, creationServiceFactory: () => ({ reopenTicket: async () => ({}) }), settingsHome: async () => {} });
  assert.ok(registry.find({ kind: "button", customId: Id.REOPEN }));
  assert.equal(registry.find({ kind: "button", customId: "ticket_reopen" }), null);
  assert.ok(registry.find({ kind: "button", customId: Id.CLAIM }));
});
