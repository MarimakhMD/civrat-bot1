"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { DiscordTicketTransport } = require("../../../adapters/discord/DiscordTicketTransport");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { SupabaseTicketRepository } = require("../persistence/SupabaseTicketRepository");
const { registerTickets } = require("../register");
const { handleTicketClose } = require("../interactions/ticketCloseRoute");
const { TicketService } = require("../services/TicketService");

function createCloseService({ ticket = { guild_id: "guild", channel_id: "channel", user_id: "creator", status: "open", closed: false }, supportMember = false, findError = null, updateError = null, channelResult = { closed: true } } = {}) {
  let closeCalls = 0;
  let updateCalls = 0;
  let updates = null;
  const repository = {
    findByChannel: async () => { if (findError) throw findError; return ticket; },
    updateByChannel: async (_channelId, value) => { updateCalls += 1; updates = value; if (updateError) throw updateError; if (ticket) Object.assign(ticket, value); return ticket; },
  };
  const service = new TicketService({
    repository,
    configService: { read: async () => ({ ticket_support_role_id: "support" }) },
    transport: {
      isMemberInRole: async (member) => supportMember && member.id === "support-member",
      closeTicketChannel: async () => { closeCalls += 1; return channelResult; },
    },
  });
  return { service, get closeCalls() { return closeCalls; }, get updateCalls() { return updateCalls; }, get updates() { return updates; } };
}

const closeInput = { guildId: "guild", channelId: "channel", member: { id: "creator" } };

test("close succeeds for the ticket creator and preserves the channel", async () => {
  const fixture = createCloseService();
  const result = await fixture.service.closeTicket(closeInput);
  assert.equal(result.code, "TICKET_CLOSED");
  assert.equal(result.closed, true);
  assert.equal(fixture.closeCalls, 1);
  assert.deepEqual(fixture.updates.status, "closed");
  assert.equal(fixture.updates.closed, true);
  assert.ok(fixture.updates.closed_at);
});

test("support role may close a ticket while another user may not", async () => {
  const support = createCloseService({ supportMember: true });
  assert.equal((await support.service.closeTicket({ ...closeInput, member: { id: "support-member" } })).code, "TICKET_CLOSED");
  const unauthorized = createCloseService();
  assert.equal((await unauthorized.service.closeTicket({ ...closeInput, member: { id: "other" } })).code, "TICKET_UNAUTHORIZED");
  assert.equal(unauthorized.closeCalls, 0);
});

test("close rejects missing, closed, deleted, and cross-guild tickets", async () => {
  assert.equal((await createCloseService({ ticket: null }).service.closeTicket(closeInput)).code, "TICKET_NOT_FOUND");
  assert.equal((await createCloseService({ ticket: { guild_id: "guild", user_id: "creator", status: "closed", closed: true } }).service.closeTicket(closeInput)).code, "TICKET_ALREADY_CLOSED");
  assert.equal((await createCloseService({ ticket: { guild_id: "guild", user_id: "creator", status: "deleted", closed: true } }).service.closeTicket(closeInput)).code, "TICKET_ALREADY_DELETED");
  assert.equal((await createCloseService({ ticket: { guild_id: "other-guild", user_id: "creator", status: "open", closed: false } }).service.closeTicket(closeInput)).code, "TICKET_GUILD_MISMATCH");
});

test("Discord and Supabase errors return a structured close failure", async () => {
  assert.equal((await createCloseService({ channelResult: { closed: false, code: "TICKET_CLOSE_FAILED" } }).service.closeTicket(closeInput)).code, "TICKET_CLOSE_FAILED");
  assert.equal((await createCloseService({ findError: new Error("select failed") }).service.closeTicket(closeInput)).code, "TICKET_CLOSE_FAILED");
  assert.equal((await createCloseService({ updateError: new Error("update failed") }).service.closeTicket(closeInput)).code, "TICKET_CLOSE_FAILED");
});

test("a ticket can only be closed once", async () => {
  const fixture = createCloseService();
  assert.equal((await fixture.service.closeTicket(closeInput)).code, "TICKET_CLOSED");
  assert.equal((await fixture.service.closeTicket(closeInput)).code, "TICKET_ALREADY_CLOSED");
  assert.equal(fixture.closeCalls, 1);
  assert.equal(fixture.updateCalls, 1);
});

test("Discord transport locks the creator without deleting the channel", async () => {
  let overwrite;
  let deleted = false;
  const channel = {
    isTextBased: () => true,
    manageable: true,
    permissionOverwrites: { edit: async (...args) => { overwrite = args; } },
    delete: async () => { deleted = true; },
  };
  const transport = new DiscordTicketTransport({ guild: { channels: { cache: new Map([["channel", channel]]) } } });
  assert.deepEqual(await transport.closeTicketChannel("channel", "creator"), { closed: true, code: "TICKET_CHANNEL_CLOSED" });
  assert.deepEqual(overwrite.slice(0, 2), ["creator", { SendMessages: false }]);
  assert.equal(deleted, false);
});

test("close route replies with the structured result", async () => {
  let response;
  const result = await handleTicketClose({
    guildId: "guild",
    t: (key) => key,
    envelope: { discordChannel: { id: "channel" }, discordMember: { id: "creator" }, transport: { reply: async (payload) => { response = payload; } } },
  }, () => ({ closeTicket: async () => ({ closed: true, code: "TICKET_CLOSED" }) }));
  assert.equal(result.code, "TICKET_CLOSED");
  assert.equal(response.view.content, "tickets.TICKET_CLOSED");
});

test("close route is registered while Claim remains untouched", () => {
  const registry = new InteractionRegistry();
  registerTickets({ registry, service: { read: async () => ({}) }, creationServiceFactory: () => ({ closeTicket: async () => ({}) }), settingsHome: async () => {} });
  assert.ok(registry.find({ kind: "button", customId: Id.CLOSE }));
  assert.equal(registry.find({ kind: "button", customId: Id.CLAIM }), null);
});

test("Supabase repository finds and updates a ticket by channel", async () => {
  const calls = [];
  const repository = new SupabaseTicketRepository({ supabase: { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { channel_id: "channel" }, error: null }) }) }),
    update: (updates) => ({ eq: (_field, channelId) => ({ select: () => ({ single: async () => { calls.push({ channelId, updates }); return { data: { channel_id: channelId, ...updates }, error: null }; } }) }) }),
  }) } });
  assert.equal((await repository.findByChannel("channel")).channel_id, "channel");
  assert.equal((await repository.updateByChannel("channel", { closed: true })).closed, true);
  assert.deepEqual(calls, [{ channelId: "channel", updates: { closed: true } }]);
});
