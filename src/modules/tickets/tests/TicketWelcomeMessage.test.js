"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DiscordTicketTransport } = require("../../../adapters/discord/DiscordTicketTransport");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { InteractionRegistry } = require("../../../core/interactions");
const { registerTickets } = require("../register");
const { TicketService } = require("../services/TicketService");
const { TicketWelcomeService } = require("../services/TicketWelcomeService");
const fr = require("../translations/fr.json");
const en = require("../translations/en.json");
const { InMemoryTicketCounterRepository } = require("../persistence/InMemoryTicketCounterRepository");
const { TicketChannelNamingService } = require("../services/TicketChannelNamingService");

function translate(dictionary) {
  return (key) => key.split(".").reduce((value, segment) => value[segment], dictionary);
}

function createTicketService({ createChannelError = null, welcomeError = null, deleteError = null, ticketLog = null } = {}) {
  let welcomeCalls = 0;
  let persisted = 0;
  const deleted = [];
  const service = new TicketService({
    // C9 : nommage obligatoire (plus de repli ticket-<userId>).
    counterRepository: new InMemoryTicketCounterRepository(),
    channelNamingService: new TicketChannelNamingService(),
    configService: { read: async () => ({ tickets_enabled: true, ticket_category_id: "category", ticket_support_role_id: "support" }) },
    repository: { findOpen: async () => null, create: async (record) => { persisted += 1; return record; } },
    welcomeService: new TicketWelcomeService(),
    ticketLog,
    transport: {
      getCategory: async () => ({ id: "category" }),
      getSupportRole: async () => ({ id: "support" }),
      getMember: async () => ({ id: "creator" }),
      getBotMember: async () => ({ id: "bot" }),
      createTicketChannel: async () => { if (createChannelError) throw createChannelError; return { id: "channel", isTextBased: () => true }; },
      applyTicketOverwrites: async () => ({ applied: true }),
      sendTicketWelcome: async () => { welcomeCalls += 1; if (welcomeError) throw welcomeError; },
      deleteTicketChannel: async (id) => { deleted.push(id); if (deleteError) throw deleteError; },
    },
  });
  return { service, deleted, get welcomeCalls() { return welcomeCalls; }, get persisted() { return persisted; } };
}

test("welcome view is localized and contains creator, support role, and stable controls", () => {
  const welcome = new TicketWelcomeService();
  const member = { id: "creator" };
  const supportRole = { id: "support" };
  const french = welcome.build({ t: translate(fr), member, supportRole });
  const english = welcome.build({ t: translate(en), member, supportRole });
  assert.equal(french.title, "🎫 Nouveau ticket");
  assert.equal(english.title, "🎫 New ticket");
  assert.equal(french.fields[0].value, "<@creator>");
  assert.equal(french.fields[1].value, "<@&support>");
  // P15 : l'accueil expose les 5 actions du cycle de vie (capacité max d'une
  // ActionRow Discord), toutes branchées sur les routes modulaires stables.
  const expectedControls = [Id.CLOSE, Id.CLAIM, Id.RENAME, Id.ADD_MEMBER, Id.REMOVE_MEMBER];
  assert.deepEqual(french.components.map((component) => component.customId), expectedControls);
  assert.deepEqual(english.components.map((component) => component.customId), [
    "civrat:v1:tickets:close", "civrat:v1:tickets:claim", "civrat:v1:tickets:rename",
    "civrat:v1:tickets:add-member", "civrat:v1:tickets:remove-member",
  ]);
});

test("Claim control is registered separately from legacy interactions", () => {
  const registry = new InteractionRegistry();
  registerTickets({ registry, service: { read: async () => ({}) }, creationServiceFactory: () => ({ createTicket: async () => ({}) }), settingsHome: async () => {} });
  assert.ok(registry.find({ kind: "button", customId: Id.CLOSE }));
  assert.ok(registry.find({ kind: "button", customId: Id.CLAIM }));
  assert.equal(registry.find({ kind: "button", customId: "ticket_claim" }), null);
});

test("ticket service sends welcome only after channel creation and overwrites", async () => {
  const fixture = createTicketService();
  const result = await fixture.service.createTicket({ guildId: "guild", member: { id: "creator" }, t: translate(en) });
  assert.equal(result.code, "TICKET_CREATED");
  assert.equal(fixture.welcomeCalls, 1);
  assert.equal(fixture.persisted, 1);
  const failedCreation = createTicketService({ createChannelError: new Error("Discord failure") });
  const failedResult = await failedCreation.service.createTicket({ guildId: "guild", member: { id: "creator" }, t: translate(en) });
  assert.equal(failedResult.code, "TICKET_CHANNEL_CREATION_FAILED");
  assert.equal(failedCreation.welcomeCalls, 0);
});

test("welcome send failure returns a structured result without persistence", async () => {
  const fixture = createTicketService({ welcomeError: new Error("send failed") });
  const result = await fixture.service.createTicket({ guildId: "guild", member: { id: "creator" }, t: translate(en) });
  assert.equal(result.code, "TICKET_WELCOME_SEND_FAILED");
  assert.equal(fixture.welcomeCalls, 1);
  assert.equal(fixture.persisted, 0);
  // P13 (B2) : le salon créé est supprimé — plus de ticket orphelin.
  assert.deepEqual(fixture.deleted, ["channel"]);
});

test("welcome failure with a failing compensation still returns the original error and logs the orphan", async () => {
  const events = [];
  const fixture = createTicketService({ welcomeError: new Error("send failed"), deleteError: new Error("cannot delete"), ticketLog: (event) => events.push(event) });
  const result = await fixture.service.createTicket({ guildId: "guild", member: { id: "creator" }, t: translate(en) });
  assert.equal(result.code, "TICKET_WELCOME_SEND_FAILED");
  assert.deepEqual(fixture.deleted, ["channel"], "compensation must be attempted");
  assert.deepEqual(events, [{ action: "ticket_creation_orphan", ticketChannelId: "channel", reason: "welcome" }]);
});

test("Discord transport sends an embed with prepared controls only", async () => {
  let payload;
  const channel = { isTextBased: () => true, send: async (value) => { payload = value; } };
  const transport = new DiscordTicketTransport({ guild: {} });
  const view = new TicketWelcomeService().build({ t: translate(en), member: { id: "creator" }, supportRole: { id: "support" } });
  await transport.sendTicketWelcome(channel, view);
  assert.equal(payload.embeds[0].data.title, "🎫 New ticket");
  assert.equal(payload.embeds[0].data.fields[0].value, "<@creator>");
  // P15 : les 5 contrôles tiennent dans une seule ActionRow (capacité Discord).
  const renderedIds = payload.components[0].components.map((component) => component.data.custom_id);
  assert.deepEqual(renderedIds, [Id.CLOSE, Id.CLAIM, Id.RENAME, Id.ADD_MEMBER, Id.REMOVE_MEMBER]);
  assert.equal(payload.components.length, 1);
});
