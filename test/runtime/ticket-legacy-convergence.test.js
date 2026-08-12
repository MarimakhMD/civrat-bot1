"use strict";

// P15 — convergence du moteur Tickets legacy.
// Le dispatcher interactionCreate ne contient plus aucun moteur tickets :
// tout passe par les routes modulaires civrat:v1:tickets:* (welcome à 5
// contrôles, notices post-fermeture/réouverture branchées sur ces mêmes
// routes, best-effort et sans effet sur les codes métier). La numérotation
// COUNT(*)+1 non atomique du legacy est retirée avec lui.
// Hors ligne : aucune connexion Discord/Supabase — objets simulés.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

// Runtime modulaire remplacé AVANT de charger le dispatcher : l'injection se
// fait dans require.cache (le require différé du dispatcher résout le même
// chemin absolu). Aucun vrai runtime n'est construit — hors ligne garanti.
const tryHandleCalls = [];
let tryHandleResult = false;
const runtimePath = require.resolve("../../src/runtime/getGuildSettingsRuntime");
require(runtimePath);
require.cache[runtimePath].exports = {
  getGuildSettingsRuntime: () => ({
    tryHandle: async (interaction) => { tryHandleCalls.push(interaction); return tryHandleResult; },
  }),
};

const legacyEvent = require("../../src/events/interactionCreate");
const { DiscordTicketTransport } = require("../../src/adapters/discord/DiscordTicketTransport");
const { TicketService } = require("../../src/modules/tickets/services/TicketService");
const { TicketWelcomeService } = require("../../src/modules/tickets/services/TicketWelcomeService");
const { TicketComponentId: Id } = require("../../src/modules/tickets/configuration/ticketConstants");
const { handleTicketClose } = require("../../src/modules/tickets/interactions/ticketCloseRoute");
const { handleTicketReopen } = require("../../src/modules/tickets/interactions/ticketReopenRoute");

const t = (key) => `__${key}__`;

// --- 1/2. Dispatcher convergé : délégation modulaire, moteur legacy retiré --

test("dispatcher: a modular-consumed interaction stops there, others fall through", async () => {
  const commandPathCalls = [];
  const interaction = {
    isChatInputCommand: () => { commandPathCalls.push("command-path"); return false; },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    customId: "civrat:v1:tickets:create",
  };
  tryHandleResult = true;
  await legacyEvent.execute(interaction);
  assert.equal(tryHandleCalls.length, 1);
  // Consommé par le runtime modulaire : aucun branchement legacy ensuite.
  assert.deepEqual(commandPathCalls, []);

  // Non consommée : le dispatcher se contente du chemin commande, sans
  // moteur tickets parallèle (aucune API Discord invoquée ici).
  tryHandleCalls.length = 0;
  tryHandleResult = false;
  const legacySelect = {
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,
    customId: "legacy-unregistered-select",
    values: ["support"],
    replied: false,
    deferred: false,
  };
  await legacyEvent.execute(legacySelect);
  assert.equal(tryHandleCalls.length, 1);
  assert.equal(legacySelect.replied, false); // aucune logique legacy exécutée
});

test("dispatcher: no legacy ticket engine remains (COUNT(*)+1, selects, legacy buttons)", async () => {
  const source = fs.readFileSync("src/events/interactionCreate.js", "utf8");
  for (const forbidden of ["nextTicketNumber", "ticket_create", "ticket_options", "ticket_reopen", "ticket_delete", "handleTicketButton", "handleTicketModal", "createTicketRecord", "updateTicketRecord", "supabase", "guildConfigService"]) {
    assert.ok(!source.includes(forbidden), `legacy symbol still present: ${forbidden}`);
  }
  // Les ids stables modulaires remplacent les ids legacy : le registre ne
  // connaît aucun des anciens identifiants.
  const { InteractionRegistry } = require("../../src/core/interactions");
  const { registerTickets } = require("../../src/modules/tickets/register");
  const registry = new InteractionRegistry();
  registerTickets({ registry, service: { read: async () => ({}) }, creationServiceFactory: () => ({ createTicket: async () => ({}) }), settingsHome: async () => {} });
  assert.equal(registry.find({ kind: "button", customId: "ticket_create" }), null);
  assert.equal(registry.find({ kind: "selectMenu", customId: "ticket_create" }), null);
});

// --- 3. Welcome convergé : 5 contrôles du cycle de vie ----------------------

test("welcome view exposes the 5 lifecycle controls on the modular routes", () => {
  const member = { id: "creator" };
  const supportRole = { id: "support" };
  const view = new TicketWelcomeService().build({ t, member, supportRole });
  assert.deepEqual(
    view.components.map((c) => [c.customId, c.style]),
    [
      [Id.CLOSE, "danger"],
      [Id.CLAIM, "secondary"],
      [Id.RENAME, "secondary"],
      [Id.ADD_MEMBER, "secondary"],
      [Id.REMOVE_MEMBER, "secondary"],
    ],
  );
  assert.deepEqual(view.components.map((c) => c.label), [
    "__tickets.close__", "__tickets.claim__", "__tickets.rename__", "__tickets.addMember__", "__tickets.removeMember__",
  ]);
});

// --- 4-7. Notices post-action : fermeture et réouverture ---------------------

function createLifecycleService({ noticeError = null, record = {} } = {}) {
  const notices = [];
  const updated = [];
  const base = { guild_id: "g", user_id: "creator", status: "open", closed: false };
  const service = new TicketService({
    configService: { read: async () => ({ ticket_support_role_id: "sup" }) },
    repository: {
      findByChannel: async () => ({ ...base, ...record }),
      updateByChannel: async (_channelId, updates) => { updated.push(updates); return { ...base, ...record, ...updates }; },
    },
    transport: {
      isMemberInRole: async () => true,
      closeTicketChannel: async () => ({ closed: true, code: "TICKET_CHANNEL_CLOSED" }),
      reopenTicketChannel: async () => ({ reopened: true, code: "TICKET_CHANNEL_REOPENED" }),
      sendTicketNotice: async (channelId, view) => {
        if (noticeError) throw noticeError;
        notices.push({ channelId, view });
      },
    },
  });
  return { service, notices, updated };
}

test("closeTicket sends a staff notice with reopen/delete on the modular routes", async () => {
  const { service, notices } = createLifecycleService();
  const result = await service.closeTicket({ guildId: "g", channelId: "chan", member: { id: "support" }, t });
  assert.equal(result.code, "TICKET_CLOSED");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].channelId, "chan");
  assert.equal(notices[0].view.description, "__tickets.closedNotice__");
  assert.deepEqual(
    notices[0].view.components.map((c) => [c.customId, c.style]),
    [[Id.REOPEN, "success"], [Id.DELETE, "danger"]],
  );
});

test("reopenTicket sends a notice without components", async () => {
  const { service, notices } = createLifecycleService({ record: { status: "closed", closed: true } });
  const result = await service.reopenTicket({ guildId: "g", channelId: "chan", member: { id: "support" }, t });
  assert.equal(result.code, "TICKET_REOPENED");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].view.description, "__tickets.reopenedNotice__");
  assert.deepEqual(notices[0].view.components, []);
});

test("a failing notice never changes the result codes (best-effort)", async () => {
  const failure = createLifecycleService({ noticeError: new Error("ticket_channel_unavailable") });
  const closed = await failure.service.closeTicket({ guildId: "g", channelId: "chan", member: { id: "support" }, t });
  assert.equal(closed.closed, true);
  assert.equal(closed.code, "TICKET_CLOSED");

  const reopenFailure = createLifecycleService({ noticeError: new Error("discord down"), record: { status: "closed", closed: true } });
  const reopened = await reopenFailure.service.reopenTicket({ guildId: "g", channelId: "chan", member: { id: "support" }, t });
  assert.equal(reopened.reopened, true);
  assert.equal(reopened.code, "TICKET_REOPENED");
});

test("without t or without transport.support, no notice is attempted (backward compatible)", async () => {
  const { service, notices } = createLifecycleService();
  const result = await service.closeTicket({ guildId: "g", channelId: "chan", member: { id: "support" } });
  assert.equal(result.code, "TICKET_CLOSED");
  assert.equal(notices.length, 0);

  const minimal = new TicketService({
    configService: { read: async () => ({ ticket_support_role_id: "sup" }) },
    repository: {
      findByChannel: async () => ({ guild_id: "g", user_id: "creator", status: "open", closed: false }),
      updateByChannel: async (_c, updates) => updates,
    },
    transport: {
      isMemberInRole: async () => true,
      closeTicketChannel: async () => ({ closed: true }),
    },
  });
  const minimalResult = await minimal.closeTicket({ guildId: "g", channelId: "chan", member: { id: "support" }, t });
  assert.equal(minimalResult.code, "TICKET_CLOSED");
});

// --- 8. Transport Discord : mapping des styles, erreurs, routes -------------

test("sendTicketNotice maps styles (success/danger, fallback secondary) and refuses dead channels", async () => {
  let payload = null;
  const guild = {
    channels: {
      cache: {
        get: (id) => (id === "chan" ? { isTextBased: () => true, send: async (value) => { payload = value; } } : null),
      },
    },
  };
  const transport = new DiscordTicketTransport({ guild });
  await transport.sendTicketNotice("chan", {
    description: "Notice",
    components: [
      { customId: Id.REOPEN, label: "Reopen", style: "success" },
      { customId: Id.DELETE, label: "Delete", style: "danger" },
      { customId: Id.CLAIM, label: "Claim", style: "unknown" },
    ],
  });
  const { ButtonStyle } = require("discord.js");
  const rendered = payload.components[0].components.map((c) => [c.data.custom_id, c.data.style]);
  assert.deepEqual(rendered, [[Id.REOPEN, ButtonStyle.Success], [Id.DELETE, ButtonStyle.Danger], [Id.CLAIM, ButtonStyle.Secondary]]);

  await transport.sendTicketNotice("chan", { description: "No action", components: [] });
  assert.deepEqual(payload.components, []);

  await assert.rejects(() => transport.sendTicketNotice("missing", { description: "x", components: [] }), /ticket_channel_unavailable/);
});

test("close/reopen routes pass context.t through to the service", async () => {
  const received = [];
  const replies = [];
  const envelope = {
    discordChannel: { id: "chan" },
    discordMember: { id: "member" },
    transport: { reply: async (value) => { replies.push(value); } },
  };
  const context = { guildId: "g", t, envelope };
  const factory = () => ({
    closeTicket: async (input) => { received.push(input); return { closed: true, code: "TICKET_CLOSED" }; },
    reopenTicket: async (input) => { received.push(input); return { reopened: true, code: "TICKET_REOPENED" }; },
  });
  await handleTicketClose(context, factory);
  await handleTicketReopen(context, factory);
  assert.equal(received.length, 2);
  assert.equal(received[0].t, t);
  assert.equal(received[1].t, t);
  assert.equal(replies.length, 2);
});
