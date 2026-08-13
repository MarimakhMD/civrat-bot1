"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionsBitField } = require("discord.js");
const { DiscordTicketTransport } = require("../../../adapters/discord/DiscordTicketTransport");
const { TicketService } = require("../services/TicketService");

function createTransportFixture({ manageable = true, overwriteError = null } = {}) {
  let overwrites = null;
  const channel = {
    manageable,
    permissionOverwrites: {
      set: async (value) => {
        if (overwriteError) throw overwriteError;
        overwrites = value;
      },
    },
  };
  const guild = { id: "guild", members: { me: { id: "bot" } } };
  return {
    transport: new DiscordTicketTransport({ guild }),
    channel,
    get overwrites() { return overwrites; },
  };
}

function createService({ category = { id: "category" }, supportRole = { id: "support" }, member = { id: "creator" }, botMember = { id: "bot" }, channel = { id: "channel" }, overwriteResult = { applied: true }, createChannelError = null } = {}) {
  let overwriteCalls = 0;
  const deleted = [];
  const service = new TicketService({
    configService: { read: async () => ({ tickets_enabled: true, ticket_category_id: "category", ticket_support_role_id: "support" }) },
    repository: { findOpen: async () => null, create: async (record) => record },
    transport: {
      getCategory: async () => category,
      getSupportRole: async () => supportRole,
      getMember: async () => member,
      getBotMember: async () => botMember,
      createTicketChannel: async () => { if (createChannelError) throw createChannelError; return channel; },
      applyTicketOverwrites: async () => { overwriteCalls += 1; return overwriteResult; },
      // P13 (B2) : espion de compensation.
      deleteTicketChannel: async (id) => { deleted.push(id); },
    },
  });
  return { service, deleted, get overwriteCalls() { return overwriteCalls; } };
}

test("Discord transport denies everyone and allows creator, support role, and bot", async () => {
  const fixture = createTransportFixture();
  const result = await fixture.transport.applyTicketOverwrites({
    channel: fixture.channel,
    member: { id: "creator" },
    supportRole: { id: "support" },
    botMember: { id: "bot" },
  });
  assert.deepEqual(result, { applied: true, code: "TICKET_OVERWRITES_APPLIED" });
  assert.equal(fixture.overwrites.length, 4);
  const everyone = fixture.overwrites.find((overwrite) => overwrite.id === "guild");
  const creator = fixture.overwrites.find((overwrite) => overwrite.id === "creator");
  const support = fixture.overwrites.find((overwrite) => overwrite.id === "support");
  const bot = fixture.overwrites.find((overwrite) => overwrite.id === "bot");
  assert.deepEqual(everyone.deny, [PermissionsBitField.Flags.ViewChannel]);
  for (const overwrite of [creator, support, bot]) assert.ok(overwrite.allow.includes(PermissionsBitField.Flags.ViewChannel));
  assert.ok(bot.allow.includes(PermissionsBitField.Flags.ManageChannels));
});

test("Discord transport returns structured permission and overwrite failures", async () => {
  const fixture = createTransportFixture();
  assert.deepEqual(await fixture.transport.applyTicketOverwrites({ channel: null, member: { id: "creator" }, supportRole: { id: "support" }, botMember: { id: "bot" } }), { applied: false, code: "TICKET_CHANNEL_MISSING" });
  const unmanageable = createTransportFixture({ manageable: false });
  assert.deepEqual(await unmanageable.transport.applyTicketOverwrites({ channel: unmanageable.channel, member: { id: "creator" }, supportRole: { id: "support" }, botMember: { id: "bot" } }), { applied: false, code: "TICKET_PERMISSION_INSUFFICIENT" });
  const failed = createTransportFixture({ overwriteError: new Error("Missing Permissions") });
  assert.deepEqual(await failed.transport.applyTicketOverwrites({ channel: failed.channel, member: { id: "creator" }, supportRole: { id: "support" }, botMember: { id: "bot" } }), { applied: false, code: "TICKET_OVERWRITE_FAILED" });
});

test("ticket service handles missing Discord resources without applying overwrites", async () => {
  for (const options of [{ category: null }, { supportRole: null }, { member: null }, { botMember: null }]) {
    const fixture = createService(options);
    const result = await fixture.service.createTicket({ guildId: "guild", member: { id: "creator" } });
    assert.notEqual(result.code, "TICKET_CREATED");
    assert.equal(fixture.overwriteCalls, 0);
  }
});

test("ticket service returns overwrite failure without persisting a ticket", async () => {
  const fixture = createService({ overwriteResult: { applied: false, code: "TICKET_PERMISSION_INSUFFICIENT" } });
  const result = await fixture.service.createTicket({ guildId: "guild", member: { id: "creator" } });
  assert.equal(result.code, "TICKET_PERMISSION_INSUFFICIENT");
  assert.equal(fixture.overwriteCalls, 1);
  // P13 (B2) : le salon créé est supprimé en compensation.
  assert.deepEqual(fixture.deleted, ["channel"]);
});

test("ticket service never applies overwrites when channel creation fails", async () => {
  const fixture = createService({ createChannelError: new Error("Discord error") });
  const result = await fixture.service.createTicket({ guildId: "guild", member: { id: "creator" } });
  assert.equal(result.code, "TICKET_CHANNEL_CREATION_FAILED");
  assert.equal(fixture.overwriteCalls, 0);
});
