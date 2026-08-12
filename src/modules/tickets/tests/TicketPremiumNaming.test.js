"use strict";

// Phase 10.4 — nommage Premium des salons + compteur atomique.
// Couverture exigée : Free historique inchangé, séquence 001/002/003,
// simultanéité sans collision, expiration/révocation => Free, rejet des
// formats invalides, placeholder d'unicité obligatoire, longueur Discord,
// compteurs indépendants par guilde, continuité au redémarrage, échec de
// création (trou de séquence assumé et documenté), fail-closed sans compteur.
// Hors ligne : repository d'entitlement et compteur simulés (InMemory).

const test = require("node:test");
const assert = require("node:assert/strict");
const { EntitlementService } = require("../../../core/entitlements");
const { DiscordTicketTransport } = require("../../../adapters/discord/DiscordTicketTransport");
const { toActionRows } = require("../../../adapters/discord/DiscordResponseTransport");
const { TicketService } = require("../services/TicketService");
const { TicketChannelNamingService } = require("../services/TicketChannelNamingService");
const { TicketPremiumConfigResolver } = require("../services/TicketPremiumConfigResolver");
const { InMemoryTicketCounterRepository } = require("../persistence/InMemoryTicketCounterRepository");
const { TicketPremiumConfigKey: PKey } = require("../configuration/ticketPremiumConstants");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { premiumPanelView, openPremiumFormatModal, submitPremiumFormat, resetPremiumPanel } = require("../interactions/premiumPanel");

const ACTIVE = { status: "active", ends_at: null };
const EXPIRED = { status: "active", ends_at: "2020-01-01T00:00:00.000Z" };
const INACTIVE = { status: "revoked", ends_at: null };

const t = (key) => key;
const baseConfig = { tickets_enabled: true, ticket_category_id: "cat", ticket_support_role_id: "sup" };
const richMember = { id: "member1", user: { username: "maria" }, displayName: "Maria", guild: { name: "CIVRAT" } };

function makeResolver(record) {
  return new TicketPremiumConfigResolver({ entitlementService: new EntitlementService({ repository: { findFeature: async () => record } }) });
}

function createService({ config, record, counter = new InMemoryTicketCounterRepository(), captured = { createChannel: [] }, createChannelError = null, naming = new TicketChannelNamingService() }) {
  const service = new TicketService({
    configService: { read: async () => config },
    repository: { findOpen: async () => null, create: async (r) => ({ id: "t1", ...r }) },
    counterRepository: counter,
    channelNamingService: naming,
    premiumConfigResolver: record === undefined ? null : makeResolver(record),
    transport: {
      getCategory: async () => ({ id: "cat" }),
      getSupportRole: async () => ({ id: "sup" }),
      getMember: async () => richMember,
      getBotMember: async () => ({ id: "bot" }),
      createTicketChannel: async (args) => { captured.createChannel.push(args); if (createChannelError) throw createChannelError; return { id: `chan-${captured.createChannel.length}` }; },
      applyTicketOverwrites: async () => ({ applied: true }),
    },
  });
  return { service, captured };
}

// --- 1. Free strictement inchangé ------------------------------------------

test("Free without resolver passes no name: the transport keeps the historical ticket-<userId>", async () => {
  const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" } });
  const result = await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(result.code, "TICKET_CREATED");
  assert.equal(captured.createChannel[0].name, undefined);
});

test("transport contract: without name it still creates ticket-<userId>, with name it uses it", async () => {
  const created = [];
  const transport = new DiscordTicketTransport({ guild: { channels: { create: async (opts) => { created.push(opts); return { id: "c" }; } } } });
  await transport.createTicketChannel({ category: { id: "cat" }, member: { id: "42" } });
  await transport.createTicketChannel({ category: { id: "cat" }, member: { id: "42" }, name: "ticket-001" });
  assert.equal(created[0].name, "ticket-42"); // contrat Free historique
  assert.equal(created[1].name, "ticket-001");
  assert.equal(created[1].type, created[0].type);
  assert.equal(created[1].parent, created[0].parent);
});

// --- 2/3. Premium actif : format personnalisé + séquence -------------------

test("active Premium with ticket-{number} yields the 001, 002, 003 sequence", async () => {
  const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" }, record: ACTIVE });
  await service.createTicket({ guildId: "g", member: richMember, t });
  await service.createTicket({ guildId: "g", member: { ...richMember, id: "m2" }, t });
  await service.createTicket({ guildId: "g", member: { ...richMember, id: "m3" }, t });
  assert.deepEqual(captured.createChannel.map((c) => c.name), ["ticket-001", "ticket-002", "ticket-003"]);
});

test("active Premium with a custom format renders placeholders (username, userid)", async () => {
  const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "staff-{username}-{number}" }, record: ACTIVE });
  await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(captured.createChannel[0].name, "staff-maria-001");
  const byId = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "help-{userid}" }, record: ACTIVE });
  await byId.service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(byId.captured.createChannel[0].name, "help-member1");
});

// --- 4. Simultanéité : aucune collision -------------------------------------

test("30 simultaneous creations produce 30 distinct numbers (atomic counter)", async () => {
  const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" }, record: ACTIVE });
  await Promise.all(Array.from({ length: 30 }, (_, i) => service.createTicket({ guildId: "g", member: { ...richMember, id: `m${i}` }, t })));
  const names = captured.createChannel.map((c) => c.name);
  assert.equal(new Set(names).size, 30);
  assert.ok(names.includes("ticket-001") && names.includes("ticket-030"));
});

// --- 5/6. Expiration et révocation => Free ----------------------------------

test("expired or revoked entitlement falls back to the Free naming even with a stored format", async () => {
  for (const record of [EXPIRED, INACTIVE]) {
    const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" }, record });
    await service.createTicket({ guildId: "g", member: richMember, t });
    assert.equal(captured.createChannel[0].name, undefined);
  }
});

// --- 7/8. Valeurs invalides et placeholder d'unicité ------------------------

test("an invalid stored format (no uniqueness placeholder) is ignored at consumption time", async () => {
  const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket" }, record: ACTIVE });
  await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(captured.createChannel[0].name, undefined); // fallback Free
});

test("naming service: pure rendering, sanitization, Discord length cap", () => {
  const naming = new TicketChannelNamingService();
  assert.equal(naming.build({ format: "ticket-{number}", number: 7 }), "ticket-007");
  assert.equal(naming.build({ format: "t-{username}", member: { id: "x", user: { username: "john.doe" } } }), "t-john-doe");
  assert.equal(naming.build({ format: "t-{username}", member: { id: "x", user: { username: "MARIA" } } }), "t-maria");
  assert.equal(naming.build({ format: "ticket-{number}", number: null }), null); // unicité impossible
  assert.equal(naming.build({ format: "no placeholder" }), null);
  const long = naming.build({ format: `${"a".repeat(70)}-{userid}`, member: { id: "9".repeat(40) } });
  assert.equal(long.length, 100);
  assert.ok(/^[a-z0-9][a-z0-9-_]*$/.test(long));
});

// --- 10/11. Indépendance par guilde, continuité au redémarrage ---------------

test("each guild has its own independent counter", async () => {
  const counter = new InMemoryTicketCounterRepository();
  const config = { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" };
  const g1 = createService({ config, record: ACTIVE, counter });
  const g2 = createService({ config, record: ACTIVE, counter });
  await g1.service.createTicket({ guildId: "g1", member: richMember, t });
  await g1.service.createTicket({ guildId: "g1", member: { ...richMember, id: "m2" }, t });
  await g2.service.createTicket({ guildId: "g2", member: richMember, t });
  assert.deepEqual(g1.captured.createChannel.map((c) => c.name), ["ticket-001", "ticket-002"]);
  assert.deepEqual(g2.captured.createChannel.map((c) => c.name), ["ticket-001"]);
});

test("a restarted service on the same counter continues the sequence", async () => {
  const counter = new InMemoryTicketCounterRepository();
  const config = { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" };
  const before = createService({ config, record: ACTIVE, counter });
  await before.service.createTicket({ guildId: "g", member: richMember, t });
  await before.service.createTicket({ guildId: "g", member: { ...richMember, id: "m2" }, t });
  const after = createService({ config, record: ACTIVE, counter }); // « redémarrage »
  await after.service.createTicket({ guildId: "g", member: { ...richMember, id: "m3" }, t });
  assert.equal(after.captured.createChannel[0].name, "ticket-003");
});

// --- 12. Échec de création / compteur indisponible ---------------------------

test("channels.create failure consumes the number (documented gap), next creation continues", async () => {
  const config = { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" };
  const failing = createService({ config, record: ACTIVE, createChannelError: new Error("discord down") });
  const ko = await failing.service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(ko.code, "TICKET_CHANNEL_CREATION_FAILED");

  const counter = new InMemoryTicketCounterRepository();
  const flaky = createService({ config, record: ACTIVE, counter, createChannelError: new Error("down") });
  flaky.service.transport.createTicketChannel = async (args) => {
    flaky.captured.createChannel.push(args);
    if (flaky.captured.createChannel.length === 1) throw new Error("down");
    return { id: "chan-2" };
  };
  await flaky.service.createTicket({ guildId: "g", member: richMember, t }); // consomme 001, échoue
  const ok = await flaky.service.createTicket({ guildId: "g", member: { ...richMember, id: "m2" }, t });
  assert.equal(ok.code, "TICKET_CREATED");
  assert.equal(flaky.captured.createChannel[1].name, "ticket-002"); // 001 perdu : trou assumé, documenté
});

test("counter unavailable or failing falls back to Free naming and still creates the ticket", async () => {
  const throwing = { next: async () => { throw new Error("rpc missing"); } };
  const a = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" }, record: ACTIVE, counter: throwing });
  const r1 = await a.service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(r1.code, "TICKET_CREATED");
  assert.equal(a.captured.createChannel[0].name, undefined);

  const b = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" }, record: ACTIVE, counter: null });
  const r2 = await b.service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(r2.code, "TICKET_CREATED");
  assert.equal(b.captured.createChannel[0].name, undefined);
});

test("a format without {number} never touches the counter", async () => {
  const calls = [];
  const counter = { next: async (g) => { calls.push(g); return 1; } };
  const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "staff-{username}" }, record: ACTIVE, counter });
  await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(captured.createChannel[0].name, "staff-maria");
  assert.equal(calls.length, 0);
});

// --- Settings /settings : modale de format -----------------------------------

function makeContext({ config = { ...baseConfig }, record = ACTIVE, modalValues = null } = {}) {
  const state = { config, writes: [], views: [], replies: [], modals: [] };
  const context = {
    guildId: "g",
    t,
    service: {
      read: async () => state.config,
      update: async (_g, updates) => { state.writes.push(updates); state.config = { ...state.config, ...updates }; return state.config; },
    },
    premiumConfigResolver: makeResolver(record),
    envelope: {
      modalValues,
      transport: {
        update: async ({ view }) => { state.views.push(view); },
        reply: async (payload) => { state.replies.push(payload); },
        showModal: async (modal) => { state.modals.push(modal); },
      },
    },
  };
  return { context, state };
}

test("format modal opens prefilled with the resolved value", async () => {
  const { context, state } = makeContext({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" } });
  await openPremiumFormatModal(context);
  const modal = state.modals[0];
  assert.equal(modal.customId, Id.PREMIUM_EDIT_FORMAT_SUBMIT);
  assert.equal(modal.fields.length, 1);
  assert.equal(modal.fields[0].value, "ticket-{number}");
});

test("format submit persists a valid format; empty resets to Free", async () => {
  const ok = makeContext({ modalValues: { name_format: "support-{number}" } });
  const result = await submitPremiumFormat(ok.context);
  assert.equal(result.saved, true);
  assert.deepEqual(ok.state.writes[0], { [PKey.NAME_FORMAT]: "support-{number}" });
  assert.ok(ok.state.views[0].content.includes("tickets.premiumNameFormatSaved"));

  const empty = makeContext({ modalValues: { name_format: "" } });
  await submitPremiumFormat(empty.context);
  assert.deepEqual(empty.state.writes[0], { [PKey.NAME_FORMAT]: null });
});

test("format submit rejects a format without uniqueness placeholder, without writing", async () => {
  const { context, state } = makeContext({ modalValues: { name_format: "support" } });
  const result = await submitPremiumFormat(context);
  assert.equal(result.saved, false);
  assert.equal(state.writes.length, 0);
  assert.equal(state.replies[0].view.content, "tickets.premiumErrorNameFormat");
});

test("format submit is refused without an active entitlement", async () => {
  const { context, state } = makeContext({ record: EXPIRED, modalValues: { name_format: "ticket-{number}" } });
  await submitPremiumFormat(context);
  assert.equal(state.writes.length, 0);
  assert.equal(state.views[0].components.length, 1); // vue verrouillée
});

test("active sub-view exposes the naming control, its state line, and stays within Discord limits", () => {
  const view = premiumPanelView({ t, premium: { [PKey.NAME_FORMAT]: "ticket-{number}" } });
  assert.deepEqual(
    view.components.map((c) => c.customId),
    [Id.PREMIUM_EDIT, Id.PREMIUM_PREVIEW, Id.PREMIUM_EDIT_WELCOME, Id.PREMIUM_PREVIEW_WELCOME, Id.PREMIUM_EDIT_FORMAT, Id.PREMIUM_RESET, Id.PREMIUM_TRANSCRIPT, Id.PANEL],
  );
  const rows = toActionRows(view.components);
  assert.ok(rows.length <= 5, `premium sub-view renders ${rows.length} rows`);
  assert.ok(rows[0].components.length <= 5);
  assert.ok(view.content.includes("ticket-{number}"));
  assert.ok(view.content.includes("tickets.premiumNameFormatHelp"));
});

test("reset clears the 8 premium keys including the naming format", async () => {
  const { context, state } = makeContext({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" } });
  await resetPremiumPanel(context);
  assert.equal(Object.keys(state.writes[0]).length, 8);
  assert.ok(Object.values(state.writes[0]).every((value) => value === null));
});
