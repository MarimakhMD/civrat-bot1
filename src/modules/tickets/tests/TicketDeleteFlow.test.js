"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { DiscordTicketTransport } = require("../../../adapters/discord/DiscordTicketTransport");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { registerTickets } = require("../register");
const { TicketService } = require("../services/TicketService");

function createService({ ticket = { guild_id: "guild", channel_id: "channel", user_id: "creator", status: "closed", closed: true }, supportMember = false, findError = null, updateError = null, channelResult = { deleted: true } } = {}) {
  let deleteCalls = 0;
  let updateCalls = 0;
  let updates = null;
  const service = new TicketService({
    repository: {
      findByChannel: async () => { if (findError) throw findError; return ticket; },
      updateByChannel: async (_guildId, _channelId, value) => { updateCalls += 1; updates = value; if (updateError) throw updateError; if (ticket) Object.assign(ticket, value); return ticket; },
    },
    configService: { read: async () => ({ ticket_support_role_id: "support" }) },
    transport: {
      isMemberInRole: async (member) => supportMember && member.id === "support-member",
      deleteTicketChannel: async () => { deleteCalls += 1; return channelResult; },
    },
  });
  return { service, get deleteCalls() { return deleteCalls; }, get updateCalls() { return updateCalls; }, get updates() { return updates; } };
}

const input = { guildId: "guild", channelId: "channel", member: { id: "creator" } };

test("authorized ticket manager deletes Discord channel then updates Supabase", async () => {
  const fixture = createService();
  const result = await fixture.service.deleteTicket(input);
  assert.equal(result.code, "TICKET_DELETED");
  assert.equal(fixture.deleteCalls, 1);
  assert.equal(fixture.updateCalls, 1);
  assert.deepEqual(fixture.updates.status, "deleted");
  assert.equal(fixture.updates.closed, true);
  assert.ok(fixture.updates.closed_at);
});

test("support is authorized while unrelated member is refused", async () => {
  assert.equal((await createService({ supportMember: true }).service.deleteTicket({ ...input, member: { id: "support-member" } })).code, "TICKET_DELETED");
  const unauthorized = createService();
  assert.equal((await unauthorized.service.deleteTicket({ ...input, member: { id: "other" } })).code, "TICKET_UNAUTHORIZED");
  assert.equal(unauthorized.deleteCalls, 0);
});

test("delete rejects missing, deleted, and cross-guild ticket records", async () => {
  assert.equal((await createService({ ticket: null }).service.deleteTicket(input)).code, "TICKET_NOT_FOUND");
  assert.equal((await createService({ ticket: { guild_id: "guild", user_id: "creator", status: "deleted", closed: true } }).service.deleteTicket(input)).code, "TICKET_ALREADY_DELETED");
  assert.equal((await createService({ ticket: { guild_id: "other", user_id: "creator", status: "closed", closed: true } }).service.deleteTicket(input)).code, "TICKET_GUILD_MISMATCH");
});

test("Discord and Supabase failures are structured and do not double delete", async () => {
  assert.equal((await createService({ channelResult: { deleted: false, code: "TICKET_DELETE_FAILED" } }).service.deleteTicket(input)).code, "TICKET_DELETE_FAILED");
  assert.equal((await createService({ findError: new Error("select") }).service.deleteTicket(input)).code, "TICKET_DELETE_FAILED");
  assert.equal((await createService({ updateError: new Error("update") }).service.deleteTicket(input)).code, "TICKET_DELETE_FAILED");
  const fixture = createService();
  assert.equal((await fixture.service.deleteTicket(input)).code, "TICKET_DELETED");
  assert.equal((await fixture.service.deleteTicket(input)).code, "TICKET_ALREADY_DELETED");
  assert.equal(fixture.deleteCalls, 1);
});

test("Discord transport only deletes an existing deletable ticket channel", async () => {
  let deleted = false;
  const channel = { isTextBased: () => true, deletable: true, delete: async () => { deleted = true; } };
  const transport = new DiscordTicketTransport({ guild: { channels: { cache: new Map([["channel", channel]]) } } });
  assert.deepEqual(await transport.deleteTicketChannel("channel"), { deleted: true, code: "TICKET_CHANNEL_DELETED" });
  assert.equal(deleted, true);
  const absent = new DiscordTicketTransport({ guild: { channels: { cache: new Map() } } });
  assert.deepEqual(await absent.deleteTicketChannel("channel"), { deleted: false, code: "TICKET_DELETE_FAILED" });
  const blocked = new DiscordTicketTransport({ guild: { channels: { cache: new Map([["channel", { isTextBased: () => true, deletable: false }]]) } } });
  assert.deepEqual(await blocked.deleteTicketChannel("channel"), { deleted: false, code: "TICKET_DELETE_FAILED" });
});

test("new delete route is distinct while legacy delete and Claim remain unconsumed", () => {
  const registry = new InteractionRegistry();
  registerTickets({ registry, service: { read: async () => ({}) }, creationServiceFactory: () => ({ deleteTicket: async () => ({}) }), settingsHome: async () => {} });
  assert.ok(registry.find({ kind: "button", customId: Id.DELETE }));
  assert.equal(registry.find({ kind: "button", customId: "ticket_delete" }), null);
  assert.ok(registry.find({ kind: "button", customId: Id.CLAIM }));
});
