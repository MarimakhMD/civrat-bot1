"use strict";

// Phase 10.4 — nommage Premium des salons + compteur atomique.
// Évolution nommage Free : le Free est DÉSORMAIS atomique lui aussi
// (ticket-001, paddé 3) via le MÊME compteur unique que le Premium — un seul
// canal d'incrément, aucun COUNT(*)+1.
// C9 (§12) : le repli ticket-<userId> du transport est SUPPRIMÉ. Sans nom
// résolvable, createTicket retourne TICKET_NAME_UNAVAILABLE avant tout appel
// Discord, et le transport lève s'il est appelé sans nom valide.
// Couverture exigée : Free atomique 001/002/003, Premium inchangé, séquence
// 001/002/003, simultanéité sans collision, expiration/révocation => Free
// atomique, rejet des formats invalides, placeholder d'unicité obligatoire,
// longueur Discord, compteurs indépendants par guilde, continuité au
// redémarrage, échec de création (trou de séquence assumé et documenté),
// fail-closed sans compteur.
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

// --- 1. Nommage Free atomique ------------------------------------------------

test("Free naming is atomic: ticket-001/002/003 on the shared counter", async () => {
  const counter = new InMemoryTicketCounterRepository();
  const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" }, counter });
  await service.createTicket({ guildId: "g", member: richMember, t });
  await service.createTicket({ guildId: "g", member: { ...richMember, id: "m2" }, t });
  await service.createTicket({ guildId: "g", member: { ...richMember, id: "m3" }, t });
  assert.deepEqual(captured.createChannel.map((c) => c.name), ["ticket-001", "ticket-002", "ticket-003"]);
});

test("C9 — no counter at all: TICKET_NAME_UNAVAILABLE and NO Discord call", async () => {
  const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" }, counter: null });
  const result = await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(result.code, "TICKET_NAME_UNAVAILABLE");
  assert.equal(result.created, false);
  assert.equal(captured.createChannel.length, 0); // aucun salon orphelin
});

// --- 1b. Non-régression nommage Free atomique (compteur unique partagé) ------

test("a single shared counter: a Premium ticket after a Free one continues the sequence", async () => {
  const counter = new InMemoryTicketCounterRepository();
  const free = createService({ config: { ...baseConfig }, counter });
  await free.service.createTicket({ guildId: "g", member: richMember, t });
  const premium = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "vip-{number}" }, record: ACTIVE, counter });
  await premium.service.createTicket({ guildId: "g", member: { ...richMember, id: "m2" }, t });
  assert.deepEqual(free.captured.createChannel.map((c) => c.name), ["ticket-001"]);
  assert.deepEqual(premium.captured.createChannel.map((c) => c.name), ["vip-002"]); // même compteur : pas de vip-001 orphelin
});

test("30 simultaneous Free creations produce 30 distinct atomic names", async () => {
  const counter = new InMemoryTicketCounterRepository();
  const { service, captured } = createService({ config: { ...baseConfig }, counter });
  await Promise.all(Array.from({ length: 30 }, (_, i) => service.createTicket({ guildId: "g", member: { ...richMember, id: `m${i}` }, t })));
  const names = captured.createChannel.map((c) => c.name);
  assert.equal(new Set(names).size, 30);
  assert.ok(names.includes("ticket-001") && names.includes("ticket-030"));
});

test("active Premium without a stored format uses the atomic Free naming", async () => {
  const { service, captured } = createService({ config: { ...baseConfig }, record: ACTIVE });
  const result = await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(result.code, "TICKET_CREATED");
  assert.equal(captured.createChannel[0].name, "ticket-001");
});

test("C9 — a failing counter: TICKET_NAME_UNAVAILABLE and NO Discord call", async () => {
  const throwing = { next: async () => { throw new Error("rpc missing"); } };
  const { service, captured } = createService({ config: { ...baseConfig }, counter: throwing });
  const result = await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(result.code, "TICKET_NAME_UNAVAILABLE");
  assert.equal(result.created, false);
  assert.equal(captured.createChannel.length, 0); // aucun salon orphelin
});

test("resolveFreeChannelName: direct resolution, guards and fail-closed branches", async () => {
  const { FREE_CHANNEL_NAME_FORMAT } = require("../services/TicketService");
  assert.equal(FREE_CHANNEL_NAME_FORMAT, "ticket-{number}");

  const naming = new TicketChannelNamingService();
  const service = new TicketService({
    repository: { findOpen: async () => null },
    counterRepository: new InMemoryTicketCounterRepository(),
    channelNamingService: naming,
  });
  assert.equal(await service.resolveFreeChannelName("g"), "ticket-001");
  assert.equal(await service.resolveFreeChannelName("g"), "ticket-002");
  assert.equal(await service.resolveFreeChannelName(null), null); // guilde absente
  const noCounter = new TicketService({ repository: {}, channelNamingService: naming });
  assert.equal(await noCounter.resolveFreeChannelName("g"), null); // compteur absent
  const noNaming = new TicketService({ repository: {}, counterRepository: new InMemoryTicketCounterRepository() });
  assert.equal(await noNaming.resolveFreeChannelName("g"), null); // service de nommage absent
  const failing = new TicketService({
    repository: {},
    counterRepository: { next: async () => { throw new Error("counter_storage_unavailable"); } },
    channelNamingService: naming,
  });
  assert.equal(await failing.resolveFreeChannelName("g"), null); // compteur en échec
});

test("C9 — transport contract: without name it THROWS, with name it uses it", async () => {
  const created = [];
  const transport = new DiscordTicketTransport({ guild: { channels: { create: async (opts) => { created.push(opts); return { id: "c" }; } } } });
  await assert.rejects(() => transport.createTicketChannel({ category: { id: "cat" }, member: { id: "42" } }), /ticket_name_unavailable/);
  assert.equal(created.length, 0); // lève AVANT channels.create : aucun salon orphelin
  await transport.createTicketChannel({ category: { id: "cat" }, member: { id: "42" }, name: "ticket-001" });
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "ticket-001");
  assert.equal(created[0].parent, "cat");
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

test("expired or revoked entitlement falls back to the atomic Free naming (stored Premium format never leaks)", async () => {
  for (const record of [EXPIRED, INACTIVE]) {
    const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "vip-{number}" }, record });
    await service.createTicket({ guildId: "g", member: richMember, t });
    const result = await service.createTicket({ guildId: "g", member: { ...richMember, id: "m2" }, t });
    assert.equal(result.code, "TICKET_CREATED");
    assert.deepEqual(captured.createChannel.map((c) => c.name), ["ticket-001", "ticket-002"]); // Free atomique, pas de fuite vip-*
  }
});

// --- 7/8. Valeurs invalides et placeholder d'unicité ------------------------

test("an invalid stored format (no uniqueness placeholder) is ignored: atomic Free naming takes over", async () => {
  const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket" }, record: ACTIVE });
  await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(captured.createChannel[0].name, "ticket-001"); // fallback Free atomique
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

test("C9 — counter unavailable or failing: TICKET_NAME_UNAVAILABLE, no channel created", async () => {
  const throwing = { next: async () => { throw new Error("rpc missing"); } };
  const a = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" }, record: ACTIVE, counter: throwing });
  const r1 = await a.service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(r1.code, "TICKET_NAME_UNAVAILABLE");
  assert.equal(a.captured.createChannel.length, 0);

  const b = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "ticket-{number}" }, record: ACTIVE, counter: null });
  const r2 = await b.service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(r2.code, "TICKET_NAME_UNAVAILABLE");
  assert.equal(b.captured.createChannel.length, 0);
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

// --- C9 (§12) — suppression du repli ticket-<userId> ------------------------
// Le compteur (M6 colonne + M7 RPC increment_ticket_counter) est la SEULE
// source de nommage. Compteur indisponible => TICKET_NAME_UNAVAILABLE, aucun
// appel Discord, aucun salon orphelin, aucun nom interdit.

const fs = require("node:fs");
const path = require("node:path");
const { SupabaseTicketCounterRepository } = require("../persistence/SupabaseTicketCounterRepository");

// N1 — chemin normal, de bout en bout à travers le VRAI transport Discord.
test("C9/N1 — real transport end-to-end: ticket-001/002/003 reach channels.create", async () => {
  const created = [];
  const transport = new DiscordTicketTransport({ guild: { channels: { create: async (opts) => { created.push(opts); return { id: `chan-${created.length}` }; } } } });
  const service = new TicketService({
    configService: { read: async () => baseConfig },
    repository: { findOpen: async () => null, create: async (r) => ({ id: "t1", ...r }) },
    counterRepository: new InMemoryTicketCounterRepository(),
    channelNamingService: new TicketChannelNamingService(),
    premiumConfigResolver: null,
    transport: {
      getCategory: async () => ({ id: "cat" }),
      getSupportRole: async () => ({ id: "sup" }),
      getMember: async () => richMember,
      getBotMember: async () => ({ id: "bot" }),
      createTicketChannel: (args) => transport.createTicketChannel(args),
      applyTicketOverwrites: async () => ({ applied: true }),
    },
  });
  for (const id of ["m1", "m2", "m3"]) {
    const r = await service.createTicket({ guildId: "g", member: { ...richMember, id }, t });
    assert.equal(r.code, "TICKET_CREATED");
  }
  assert.deepEqual(created.map((c) => c.name), ["ticket-001", "ticket-002", "ticket-003"]);
});

// N2 — le repository Supabase rejette tout retour de RPC non exploitable.
// Note : la ligne 19 (`if (error) throw error`) re-lance l'objet PostgREST
// BRUT, qui n'est pas une instance d'Error — d'où deux groupes d'assertions.
// TicketService attrape tout (`catch (_error)`), donc le comportement
// fail-closed est identique dans les deux cas.
test("C9/N2 — SupabaseTicketCounterRepository rejects invalid RPC returns", async () => {
  const invalidValues = [
    ["0", { data: 0, error: null }],
    ["négatif", { data: -1, error: null }],
    ["null", { data: null, error: null }],
    ["tableau (returns table)", { data: [{ ticket_counter: 1 }], error: null }],
    ["non numérique", { data: "abc", error: null }],
  ];
  for (const [label, response] of invalidValues) {
    const repo = new SupabaseTicketCounterRepository({ supabase: { rpc: async () => response } });
    await assert.rejects(() => repo.next("g"), Error, `cas « ${label} » aurait dû lever une Error`);
  }

  // Erreur PostgREST : re-lancée brute (pas une Error), mais bien propagée.
  const postgrestError = { message: "Could not find the function public.increment_ticket_counter(text)", code: "PGRST202" };
  const failing = new SupabaseTicketCounterRepository({ supabase: { rpc: async () => ({ data: null, error: postgrestError }) } });
  let thrown = "aucune exception";
  try { await failing.next("g"); } catch (error) { thrown = error; }
  assert.notEqual(thrown, "aucune exception", "l'erreur PostgREST doit être propagée");
  assert.equal(thrown, postgrestError, "l'objet PostgREST est re-lancé tel quel (ligne 19)");

  // Aucun client => garde explicite.
  const noClient = new SupabaseTicketCounterRepository({ supabase: null });
  await assert.rejects(() => noClient.next("g"), /counter_storage_unavailable/);

  const ok = new SupabaseTicketCounterRepository({ supabase: { rpc: async () => ({ data: 7, error: null }) } });
  assert.equal(await ok.next("g"), 7);
});

// N3 — échec du compteur : aucune ligne de ticket persistée non plus.
test("C9/N3 — counter failure persists NO ticket row and calls no Discord API", async () => {
  const created = [];
  const persisted = [];
  const service = new TicketService({
    configService: { read: async () => baseConfig },
    repository: { findOpen: async () => null, create: async (r) => { persisted.push(r); return { id: "t1", ...r }; } },
    counterRepository: { next: async () => { throw new Error("rpc down"); } },
    channelNamingService: new TicketChannelNamingService(),
    premiumConfigResolver: null,
    transport: {
      getCategory: async () => ({ id: "cat" }),
      getSupportRole: async () => ({ id: "sup" }),
      getMember: async () => richMember,
      getBotMember: async () => ({ id: "bot" }),
      createTicketChannel: async (args) => { created.push(args); return { id: "chan-1" }; },
      applyTicketOverwrites: async () => ({ applied: true }),
    },
  });
  const result = await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(result.code, "TICKET_NAME_UNAVAILABLE");
  assert.equal(created.length, 0);
  assert.equal(persisted.length, 0); // pas de ligne orpheline en base
});

// N4 — transport appelé avec une chaîne vide.
test("C9/N4 — transport with an empty name throws and creates nothing", async () => {
  const created = [];
  const transport = new DiscordTicketTransport({ guild: { channels: { create: async (opts) => { created.push(opts); return { id: "c" }; } } } });
  await assert.rejects(() => transport.createTicketChannel({ category: { id: "cat" }, member: { id: "42" }, name: "" }), /ticket_name_unavailable/);
  assert.equal(created.length, 0);
});

// N5 — transport appelé avec des blancs ou null explicite.
test("C9/N5 — transport rejects whitespace-only and explicit null names", async () => {
  const created = [];
  const transport = new DiscordTicketTransport({ guild: { channels: { create: async (opts) => { created.push(opts); return { id: "c" }; } } } });
  for (const name of ["   ", "\t", null, 0, {}, ["ticket-001"]]) {
    await assert.rejects(() => transport.createTicketChannel({ category: { id: "cat" }, member: { id: "42" }, name }), /ticket_name_unavailable/);
  }
  assert.equal(created.length, 0);
});

// N6 — atomicité conservée : 30 créations simultanées, 30 noms distincts et conformes.
test("C9/N6 — 30 simultaneous creations: 30 distinct names, all ticket-NNN", async () => {
  const counter = new InMemoryTicketCounterRepository();
  const { service, captured } = createService({ config: { ...baseConfig }, counter });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => service.createTicket({ guildId: "g", member: { ...richMember, id: `m${i}` }, t })));
  assert.ok(results.every((r) => r.code === "TICKET_CREATED"));
  const names = captured.createChannel.map((c) => c.name);
  assert.equal(new Set(names).size, 30);
  assert.ok(names.every((n) => /^ticket-\d{3}$/.test(n)), `noms non conformes : ${names.filter((n) => !/^ticket-\d{3}$/.test(n))}`);
  assert.ok(!names.some((n) => /^ticket-\d{15,}$/.test(n)), "aucun nom ne doit ressembler à ticket-<userId>");
});

// N7 — format Premium sans {number} : inchangé, le compteur n'est jamais consulté.
test("C9/N7 — Premium format without {number} still works and never touches the counter", async () => {
  let counterCalls = 0;
  const counter = { next: async () => { counterCalls += 1; return 1; } };
  const { service, captured } = createService({ config: { ...baseConfig, [PKey.NAME_FORMAT]: "support-{username}" }, record: ACTIVE, counter });
  const result = await service.createTicket({ guildId: "g", member: richMember, t });
  assert.equal(result.code, "TICKET_CREATED");
  assert.equal(captured.createChannel[0].name, "support-maria");
  assert.equal(counterCalls, 0); // pas de dépendance au compteur sur ce chemin
});

// N8 — la clé i18n doit exister dans les DEUX langues, sinon l'utilisateur
// verrait la clé brute (ticketCreateRoute.js traduit via t(`tickets.${code}`)).
test("C9/N8 — TICKET_NAME_UNAVAILABLE is translated in fr and en", () => {
  for (const lang of ["fr", "en"]) {
    const messages = require(`../translations/${lang}.json`).tickets;
    const value = messages.TICKET_NAME_UNAVAILABLE;
    assert.equal(typeof value, "string", `${lang}.json : clé TICKET_NAME_UNAVAILABLE absente`);
    assert.ok(value.trim().length > 10, `${lang}.json : message trop court`);
    assert.ok(!/TICKET_NAME_UNAVAILABLE|tickets\./.test(value), `${lang}.json : la valeur ressemble à une clé non traduite`);
  }
});

// N9 — garde-fou permanent : le repli interdit ne doit jamais revenir dans src/.
test("C9/N9 — no forbidden ticket-<userId> fallback remains anywhere in src/", () => {
  const root = path.join(__dirname, "..", "..", "..");
  const forbidden = /ticket-\$\{/;
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && forbidden.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(root, full));
    }
  })(root);
  assert.deepEqual(offenders, [], `repli ticket-<userId> réintroduit dans : ${offenders.join(", ")}`);
});
