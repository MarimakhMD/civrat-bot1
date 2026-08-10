"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { registerTickets } = require("../register");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { TicketService } = require("../services/TicketService");
const { SupabaseTicketRepository } = require("../persistence/SupabaseTicketRepository");
const { handleTicketCreate } = require("../interactions/ticketCreateRoute");

function createService({ config, openTicket = null, createError = null, category = { id: "category" }, supportRole = { id: "support" } } = {}) {
  let createdRecord = null;
  let channelCreates = 0;
  const service = new TicketService({
    configService: { read: async () => config },
    repository: {
      findOpen: async () => openTicket,
      create: async (record) => {
        createdRecord = record;
        if (createError) throw createError;
        return { id: "ticket-1", ...record };
      },
    },
    transport: {
      getCategory: async (id) => id === "category" ? category : null,
      getSupportRole: async (id) => id === "support" ? supportRole : null,
      getMember: async (id) => ({ id }),
      getBotMember: async () => ({ id: "bot" }),
      createTicketChannel: async () => { channelCreates += 1; return { id: "channel-1" }; },
      applyTicketOverwrites: async () => ({ applied: true }),
    },
  });
  return { service, get createdRecord() { return createdRecord; }, get channelCreates() { return channelCreates; } };
}

const completeConfig = { tickets_enabled: true, ticket_category_id: "category", ticket_support_role_id: "support" };

test("new create route consumes only the stable custom id", () => {
  const registry = new InteractionRegistry();
  registerTickets({ registry, service: { read: async () => ({}) }, creationServiceFactory: () => ({ createTicket: async () => ({}) }), settingsHome: async () => {} });
  assert.ok(registry.find({ kind: "button", customId: Id.CREATE }));
  assert.equal(registry.find({ kind: "button", customId: "ticket_create" }), null);
});

test("create route replies with the structured result", async () => {
  let response;
  const result = await handleTicketCreate({
    guildId: "guild",
    t: (key) => key,
    envelope: { discordMember: { id: "member" }, transport: { reply: async (payload) => { response = payload; } } },
  }, () => ({ createTicket: async () => ({ created: false, code: "TICKETS_DISABLED", details: {} }) }));
  assert.equal(result.code, "TICKETS_DISABLED");
  assert.equal(response.view.content, "tickets.TICKETS_DISABLED");
  assert.equal(response.ephemeral, true);
});

test("ticket creation rejects disabled and incomplete configuration before Discord creation", async () => {
  const disabled = createService({ config: { ...completeConfig, tickets_enabled: false } });
  assert.equal((await disabled.service.createTicket({ guildId: "guild", member: { id: "member" } })).code, "TICKETS_DISABLED");
  assert.equal(disabled.channelCreates, 0);
  const incomplete = createService({ config: { tickets_enabled: true, ticket_category_id: null, ticket_support_role_id: null } });
  const result = await incomplete.service.createTicket({ guildId: "guild", member: { id: "member" } });
  assert.equal(result.code, "TICKET_CONFIG_INCOMPLETE");
  assert.deepEqual(result.details, { categoryMissing: true, supportRoleMissing: true });
  assert.equal(incomplete.channelCreates, 0);
});

test("missing configured category or support role blocks Discord creation", async () => {
  const missingCategory = createService({ config: completeConfig, category: null });
  assert.equal((await missingCategory.service.createTicket({ guildId: "guild", member: { id: "member" } })).code, "TICKET_CONFIG_INCOMPLETE");
  assert.equal(missingCategory.channelCreates, 0);
  const missingRole = createService({ config: completeConfig, supportRole: null });
  assert.equal((await missingRole.service.createTicket({ guildId: "guild", member: { id: "member" } })).code, "TICKET_CONFIG_INCOMPLETE");
  assert.equal(missingRole.channelCreates, 0);
});

test("ticket creation requires guild and member context", async () => {
  const fixture = createService({ config: completeConfig });
  assert.equal((await fixture.service.createTicket({ guildId: null, member: { id: "member" } })).code, "TICKET_GUILD_OR_MEMBER_MISSING");
  assert.equal((await fixture.service.createTicket({ guildId: "guild", member: null })).code, "TICKET_GUILD_OR_MEMBER_MISSING");
});

test("one open ticket blocks Discord and persistence creation", async () => {
  const fixture = createService({ config: completeConfig, openTicket: { channel_id: "existing" } });
  const result = await fixture.service.createTicket({ guildId: "guild", member: { id: "member" } });
  assert.equal(result.code, "OPEN_TICKET_EXISTS");
  assert.equal(fixture.channelCreates, 0);
  assert.equal(fixture.createdRecord, null);
});

test("no open ticket creates a schema-compatible Supabase record", async () => {
  const fixture = createService({ config: completeConfig });
  const result = await fixture.service.createTicket({ guildId: "guild", member: { id: "member" } });
  assert.equal(result.code, "TICKET_CREATED");
  assert.deepEqual(fixture.createdRecord, { guild_id: "guild", user_id: "member", channel_id: "channel-1", category: "support", status: "open", closed: false });
});

test("Supabase persistence failure is structured", async () => {
  const fixture = createService({ config: completeConfig, createError: new Error("database unavailable") });
  const result = await fixture.service.createTicket({ guildId: "guild", member: { id: "member" } });
  assert.equal(result.code, "PERSISTENCE_ERROR");
  assert.equal(fixture.channelCreates, 1);
});

test("Supabase repository creates records and surfaces insert errors", async () => {
  const inserted = [];
  const repository = new SupabaseTicketRepository({ supabase: { from: () => ({ insert: (record) => { inserted.push(record); return { select: () => ({ single: async () => ({ data: { id: "ticket-1", ...record }, error: null }) }) }; } }) } });
  assert.equal((await repository.create({ guild_id: "guild" })).id, "ticket-1");
  assert.equal(inserted.length, 1);
  const failing = new SupabaseTicketRepository({ supabase: { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: new Error("insert failed") }) }) }) }) } });
  await assert.rejects(() => failing.create({}), /insert failed/);
});
