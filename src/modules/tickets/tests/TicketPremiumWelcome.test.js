"use strict";

// Phase 10.3 — contenu du ticket Premium : message/embed d'accueil
// personnalisable avec placeholders, salon de transcript configurable.
// Garanties couvertes : Free strictement inchangé, aucune fuite sans
// entitlement (inactif/expiré), persistance validée, aperçu fidèle.
// Hors ligne : repository d'entitlement simulé, aucun accès Discord/Supabase.

const test = require("node:test");
const assert = require("node:assert/strict");
const { EntitlementService } = require("../../../core/entitlements");
const { toActionRows } = require("../../../adapters/discord/DiscordResponseTransport");
const { TicketService } = require("../services/TicketService");
const { TicketWelcomeService } = require("../services/TicketWelcomeService");
const { TicketPremiumConfigResolver } = require("../services/TicketPremiumConfigResolver");
const { TicketPlaceholderRenderer } = require("../services/TicketPlaceholderRenderer");
const { TicketPremiumConfigKey: PKey } = require("../configuration/ticketPremiumConstants");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const {
  openPremiumWelcomeModal,
  submitPremiumWelcome,
  previewPremiumWelcome,
  selectPremiumTranscript,
  resetPremiumPanel,
  premiumPanelView,
} = require("../interactions/premiumPanel");

const ACTIVE = { status: "active", ends_at: null };
const EXPIRED = { status: "active", ends_at: "2020-01-01T00:00:00.000Z" };
const INACTIVE = { status: "revoked", ends_at: null };
const TRANSCRIPT_CHANNEL = "123456789012345678";

const t = (key) => key;
const richMember = { id: "member", user: { username: "maria" }, displayName: "Maria", guild: { name: "CIVRAT" } };

function makeResolver(record) {
  return new TicketPremiumConfigResolver({ entitlementService: new EntitlementService({ repository: { findFeature: async () => record } }) });
}

// --- TicketWelcomeService -------------------------------------------------

test("Free welcome embed stays exactly the historical embed without custom message", () => {
  const welcome = new TicketWelcomeService().build({ t, member: { id: "m1" }, supportRole: { id: "r1" } });
  assert.equal(welcome.title, "tickets.welcomeTitle");
  assert.equal(welcome.description, "tickets.welcomeDescription");
  assert.deepEqual(welcome.fields, [
    { name: "tickets.welcomeCreator", value: "<@m1>", inline: true },
    { name: "tickets.welcomeSupportRole", value: "<@&r1>", inline: true },
  ]);
  // P15 : 5 contrôles du cycle de vie sur les routes modulaires.
  assert.deepEqual(welcome.components.map((c) => c.customId), [Id.CLOSE, Id.CLAIM, Id.RENAME, Id.ADD_MEMBER, Id.REMOVE_MEMBER]);
});

test("custom welcome message overrides only the description, with placeholders resolved", () => {
  const welcome = new TicketWelcomeService().build({
    t,
    member: richMember,
    supportRole: { id: "sup" },
    welcomeMessage: "Bienvenue {mention} ({username}) sur {server}, rôle {supportrole} !",
  });
  assert.equal(welcome.description, "Bienvenue <@member> (maria) sur CIVRAT, rôle <@&sup> !");
  assert.equal(welcome.title, "tickets.welcomeTitle");
  assert.deepEqual(welcome.components.map((c) => c.customId), [Id.CLOSE, Id.CLAIM, Id.RENAME, Id.ADD_MEMBER, Id.REMOVE_MEMBER]);
});

test("ticket placeholders follow the product convention (unknown tokens preserved, missing data empty)", () => {
  const renderer = new TicketPlaceholderRenderer();
  assert.equal(renderer.render("{user}|{mention}|{username}|{displayname}|{userid}|{server}|{supportrole}", { member: richMember, supportRole: { id: "r" } }), "<@member>|<@member>|maria|Maria|member|CIVRAT|<@&r>");
  assert.equal(renderer.render("ok {unknown} ok", { member: richMember }), "ok {unknown} ok");
  assert.equal(renderer.render("{username}/{server}", { member: { id: "x" } }), "/");
});

// --- TicketService : accueil ----------------------------------------------

function createTicketService({ config, record }) {
  const sent = { welcome: null };
  const service = new TicketService({
    configService: { read: async () => config },
    repository: { findOpen: async () => null, create: async (r) => ({ id: "t1", ...r }) },
    welcomeService: new TicketWelcomeService(),
    premiumConfigResolver: record === undefined ? null : makeResolver(record),
    transport: {
      getCategory: async () => ({ id: "cat" }),
      getSupportRole: async () => ({ id: "sup" }),
      getMember: async () => richMember,
      getBotMember: async () => ({ id: "bot" }),
      createTicketChannel: async () => ({ id: "chan" }),
      applyTicketOverwrites: async () => ({ applied: true }),
      sendTicketWelcome: async (_channel, welcome) => { sent.welcome = welcome; },
    },
  });
  return { service, sent };
}

const baseConfig = { tickets_enabled: true, ticket_category_id: "cat", ticket_support_role_id: "sup" };
const welcomeMessage = "Bienvenue {mention}, équipe {supportrole} à votre écoute.";

test("ticket creation without resolver sends the historical Free welcome", async () => {
  const { service, sent } = createTicketService({ config: baseConfig });
  const result = await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(result.code, "TICKET_CREATED");
  assert.equal(sent.welcome.description, "tickets.welcomeDescription");
});

test("no Premium leak: stored welcome message is ignored when the entitlement is inactive", async () => {
  for (const record of [INACTIVE, EXPIRED]) {
    const { service, sent } = createTicketService({ config: { ...baseConfig, [PKey.WELCOME_MESSAGE]: welcomeMessage }, record });
    await service.createTicket({ guildId: "g", member: richMember, t });
    assert.equal(sent.welcome.description, "tickets.welcomeDescription");
  }
});

test("active Premium sends the custom welcome message with resolved placeholders", async () => {
  const { service, sent } = createTicketService({ config: { ...baseConfig, [PKey.WELCOME_MESSAGE]: welcomeMessage }, record: ACTIVE });
  await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(sent.welcome.description, "Bienvenue <@member>, équipe <@&sup> à votre écoute.");
  assert.equal(sent.welcome.title, "tickets.welcomeTitle");
});

// --- TicketService : transcript --------------------------------------------

function closeTicketService({ config, record }) {
  const calls = { deliver: [] };
  const service = new TicketService({
    configService: { read: async () => config },
    repository: {
      findByChannel: async () => ({ guild_id: "g", user_id: "u", status: "open", closed: false }),
      updateByChannel: async (_c, updates) => updates,
    },
    transcriptService: { deliver: async (args) => { calls.deliver.push(args); return { delivered: true, code: "TRANSCRIPT_SENT" }; } },
    premiumConfigResolver: record === undefined ? null : makeResolver(record),
    transport: {
      isMemberInRole: async () => true,
      closeTicketChannel: async () => ({ closed: true, code: "TICKET_CHANNEL_CLOSED" }),
    },
  });
  return { service, calls };
}

test("active Premium closes with the configured transcript channel", async () => {
  const { service, calls } = closeTicketService({ config: { ...baseConfig, [PKey.TRANSCRIPT_CHANNEL_ID]: TRANSCRIPT_CHANNEL }, record: ACTIVE });
  const result = await service.closeTicket({ guildId: "g", channelId: "chan", member: { id: "u" } });
  assert.equal(result.code, "TICKET_CLOSED");
  assert.equal(calls.deliver.length, 1);
  assert.equal(calls.deliver[0].logChannelId, TRANSCRIPT_CHANNEL);
});

test("without Premium the transcript destination stays the historical config key (no leak)", async () => {
  for (const record of [undefined, INACTIVE, EXPIRED]) {
    const { service, calls } = closeTicketService({
      config: { ...baseConfig, ticket_log_channel_id: "legacy-log", [PKey.TRANSCRIPT_CHANNEL_ID]: TRANSCRIPT_CHANNEL },
      record,
    });
    await service.closeTicket({ guildId: "g", channelId: "chan", member: { id: "u" } });
    assert.equal(calls.deliver[0].logChannelId, "legacy-log");
  }
});

// --- Handlers /settings Premium (contenu) ----------------------------------

function makeContext({ config = { ...baseConfig }, record = ACTIVE, modalValues = null, values = [] } = {}) {
  const state = { config, writes: [], views: [], replies: [], embeds: [], modals: [] };
  const context = {
    guildId: "g",
    t,
    userId: "admin",
    service: {
      read: async () => state.config,
      update: async (_g, updates) => { state.writes.push(updates); state.config = { ...state.config, ...updates }; return state.config; },
    },
    premiumConfigResolver: makeResolver(record),
    envelope: {
      modalValues,
      values,
      discordMember: { id: "admin" },
      transport: {
        update: async ({ view }) => { state.views.push(view); },
        reply: async (payload) => { state.replies.push(payload); },
        replyEmbed: async (payload) => { state.embeds.push(payload); },
        showModal: async (modal) => { state.modals.push(modal); },
      },
    },
  };
  return { context, state };
}

test("welcome edit opens a single paragraph field prefilled with the resolved value", async () => {
  const { context, state } = makeContext({ config: { ...baseConfig, [PKey.WELCOME_MESSAGE]: "Salut {mention}" } });
  await openPremiumWelcomeModal(context);
  const modal = state.modals[0];
  assert.equal(modal.customId, Id.PREMIUM_EDIT_WELCOME_SUBMIT);
  assert.equal(modal.fields.length, 1);
  assert.equal(modal.fields[0].id, "welcome_message");
  assert.equal(modal.fields[0].style, "paragraph");
  assert.equal(modal.fields[0].value, "Salut {mention}");
  assert.equal(modal.fields[0].required, false);
});

test("welcome modal stays locked without an active entitlement", async () => {
  const { context, state } = makeContext({ record: INACTIVE });
  await openPremiumWelcomeModal(context);
  assert.equal(state.modals.length, 0);
  assert.equal(state.views[0].components.length, 1);
});

test("welcome submit persists the message (empty = Free fallback) and re-renders", async () => {
  const filled = makeContext({ modalValues: { welcome_message: "  Bienvenue {mention} !  " } });
  const result = await submitPremiumWelcome(filled.context);
  assert.equal(result.saved, true);
  assert.deepEqual(filled.state.writes[0], { [PKey.WELCOME_MESSAGE]: "Bienvenue {mention} !" });
  assert.ok(filled.state.views[0].content.includes("tickets.premiumWelcomeSaved"));
  assert.ok(filled.state.views[0].content.includes("Bienvenue {mention} !"));

  const cleared = makeContext({ modalValues: { welcome_message: "" } });
  await submitPremiumWelcome(cleared.context);
  assert.deepEqual(cleared.state.writes[0], { [PKey.WELCOME_MESSAGE]: null });
});

test("welcome submit rejects an oversized message without writing", async () => {
  const { context, state } = makeContext({ modalValues: { welcome_message: "x".repeat(2001) } });
  const result = await submitPremiumWelcome(context);
  assert.equal(result.saved, false);
  assert.equal(state.writes.length, 0);
  assert.equal(state.replies[0].view.content, "tickets.premiumErrorWelcomeMessage");
});

test("welcome submit is refused without an active entitlement", async () => {
  const { context, state } = makeContext({ record: EXPIRED, modalValues: { welcome_message: "Bonjour" } });
  await submitPremiumWelcome(context);
  assert.equal(state.writes.length, 0);
  assert.equal(state.views[0].components.length, 1); // vue verrouillée
});

test("transcript select persists the channel and re-renders with a confirmation notice", async () => {
  const { context, state } = makeContext({ values: [TRANSCRIPT_CHANNEL] });
  await selectPremiumTranscript(context);
  assert.deepEqual(state.writes[0], { [PKey.TRANSCRIPT_CHANNEL_ID]: TRANSCRIPT_CHANNEL });
  assert.ok(state.views[0].content.includes("tickets.premiumTranscriptSaved"));
  assert.ok(state.views[0].content.includes(`<#${TRANSCRIPT_CHANNEL}>`));
});

test("welcome preview renders the real welcome embed ephemerally, resolved for the previewing admin", async () => {
  const { context, state } = makeContext({ config: { ...baseConfig, [PKey.WELCOME_MESSAGE]: "Salut {mention} !" } });
  const welcome = await previewPremiumWelcome(context);
  assert.equal(welcome.description, "Salut <@admin> !");
  const sent = state.embeds[0];
  assert.equal(sent.ephemeral, true);
  assert.equal(sent.embed.title, "tickets.welcomeTitle");
  assert.equal(sent.embed.description, "Salut <@admin> !");
  assert.deepEqual(sent.embed.fields[0].value, "<@admin>");
  assert.deepEqual(sent.components.map((c) => c.customId), [Id.CLOSE, Id.CLAIM, Id.RENAME, Id.ADD_MEMBER, Id.REMOVE_MEMBER]);
  assert.ok(toActionRows(sent.components).length <= 5);
});

test("welcome preview without custom message shows the Free default (clean fallback)", async () => {
  const { context, state } = makeContext();
  await previewPremiumWelcome(context);
  assert.equal(state.embeds[0].embed.description, "tickets.welcomeDescription");
});

test("welcome preview is locked without an active entitlement", async () => {
  const { context, state } = makeContext({ record: INACTIVE });
  await previewPremiumWelcome(context);
  assert.equal(state.embeds.length, 0);
  assert.equal(state.views[0].components.length, 1);
});

test("reset clears the 8 premium keys including welcome message and transcript channel", async () => {
  const { context, state } = makeContext({ config: { ...baseConfig, [PKey.WELCOME_MESSAGE]: "x", [PKey.TRANSCRIPT_CHANNEL_ID]: TRANSCRIPT_CHANNEL } });
  await resetPremiumPanel(context);
  assert.equal(Object.keys(state.writes[0]).length, 8);
  assert.ok(Object.values(state.writes[0]).every((value) => value === null));
});

test("active sub-view state lines cover welcome message and transcript channel", () => {
  const view = premiumPanelView({ t, premium: { [PKey.WELCOME_MESSAGE]: "Salut", [PKey.TRANSCRIPT_CHANNEL_ID]: TRANSCRIPT_CHANNEL } });
  assert.ok(view.content.includes("Salut"));
  assert.ok(view.content.includes(`<#${TRANSCRIPT_CHANNEL}>`));
  assert.ok(view.content.includes("tickets.premiumPlaceholdersHelp")); // liste {mention}…{supportrole} en réel
});
