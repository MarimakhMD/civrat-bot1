"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { DiscordTicketTransport } = require("../../../adapters/discord/DiscordTicketTransport");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { openTicketRename, handleTicketRename } = require("../interactions/ticketRenameRoute");
const { registerTickets } = require("../register");
const { TicketService } = require("../services/TicketService");

function createService({ ticket = { guild_id: "guild", channel_id: "channel", user_id: "creator", status: "open", closed: false }, supportMember = false, findError = null, channelResult = { renamed: true } } = {}) {
  let renameCalls = 0;
  const service = new TicketService({
    repository: { findByChannel: async () => { if (findError) throw findError; return ticket; } },
    configService: { read: async () => ({ ticket_support_role_id: "support" }) },
    transport: {
      isMemberInRole: async (member) => supportMember && member.id === "support-member",
      renameTicketChannel: async () => { renameCalls += 1; return channelResult; },
    },
  });
  return { service, get renameCalls() { return renameCalls; } };
}

const input = { guildId: "guild", channelId: "channel", member: { id: "creator" }, name: "billing-support" };

test("creator and support can rename a ticket with a valid channel name", async () => {
  const creator = createService();
  assert.equal((await creator.service.renameTicket(input)).code, "TICKET_RENAMED");
  assert.equal(creator.renameCalls, 1);
  const support = createService({ supportMember: true });
  assert.equal((await support.service.renameTicket({ ...input, member: { id: "support-member" } })).code, "TICKET_RENAMED");
});

test("rename rejects invalid names before Discord operations", async () => {
  for (const name of ["", "A-name", "with space", "a".repeat(91)]) {
    const fixture = createService();
    assert.equal((await fixture.service.renameTicket({ ...input, name })).code, "TICKET_INVALID_NAME");
    assert.equal(fixture.renameCalls, 0);
  }
});

test("rename rejects missing, deleted, cross-guild, and unauthorized tickets", async () => {
  assert.equal((await createService({ ticket: null }).service.renameTicket(input)).code, "TICKET_NOT_FOUND");
  assert.equal((await createService({ ticket: { guild_id: "guild", user_id: "creator", status: "deleted", closed: true } }).service.renameTicket(input)).code, "TICKET_ALREADY_DELETED");
  assert.equal((await createService({ ticket: { guild_id: "other", user_id: "creator", status: "open", closed: false } }).service.renameTicket(input)).code, "TICKET_GUILD_MISMATCH");
  assert.equal((await createService().service.renameTicket({ ...input, member: { id: "other" } })).code, "TICKET_UNAUTHORIZED");
});

test("Discord and repository errors are structured", async () => {
  assert.equal((await createService({ findError: new Error("select") }).service.renameTicket(input)).code, "TICKET_RENAME_FAILED");
  assert.equal((await createService({ channelResult: { renamed: false, code: "TICKET_RENAME_FAILED" } }).service.renameTicket(input)).code, "TICKET_RENAME_FAILED");
});

test("Discord transport renames only existing manageable text channels", async () => {
  let name;
  const channel = { isTextBased: () => true, manageable: true, setName: async (value) => { name = value; } };
  const transport = new DiscordTicketTransport({ guild: { channels: { cache: new Map([["channel", channel]]) } } });
  assert.deepEqual(await transport.renameTicketChannel("channel", "billing-support"), { renamed: true, code: "TICKET_CHANNEL_RENAMED" });
  assert.equal(name, "billing-support");
  const absent = new DiscordTicketTransport({ guild: { channels: { cache: new Map() } } });
  assert.deepEqual(await absent.renameTicketChannel("channel", "billing-support"), { renamed: false, code: "TICKET_RENAME_FAILED" });
});

test("rename routes use stable ids without consuming legacy rename", async () => {
  const registry = new InteractionRegistry();
  registerTickets({ registry, service: { read: async () => ({}) }, creationServiceFactory: () => ({ renameTicket: async () => ({ renamed: true, code: "TICKET_RENAMED" }) }), settingsHome: async () => {} });
  assert.ok(registry.find({ kind: "button", customId: Id.RENAME }));
  assert.ok(registry.find({ kind: "modal", customId: Id.RENAME_SUBMIT }));
  assert.equal(registry.find({ kind: "modal", customId: "ticket_rename" }), null);
  let modal;
  await openTicketRename({ t: (key) => key, envelope: { transport: { showModal: async (value) => { modal = value; } } } });
  assert.equal(modal.customId, Id.RENAME_SUBMIT);
  let response;
  await handleTicketRename({ guildId: "guild", t: (key) => key, envelope: { discordChannel: { id: "channel" }, discordMember: { id: "creator" }, modalValues: { ticket_name: "billing-support" }, transport: { reply: async (value) => { response = value; } } } }, () => ({ renameTicket: async () => ({ renamed: true, code: "TICKET_RENAMED" }) }));
  assert.equal(response.view.content, "tickets.TICKET_RENAMED");
});
