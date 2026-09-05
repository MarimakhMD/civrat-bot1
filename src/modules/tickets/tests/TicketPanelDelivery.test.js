"use strict";

// P12.2 (B1) — contrat de livraison : la destination est le salon texte fourni
// par l'appelant, jamais la catégorie de configuration.
//
// M8 — la livraison crée désormais une LIGNE dans public.ticket_panels.
// Ordre validé (D-B) : send Discord → insert Supabase → edit des boutons.
// Le panelId naissant à l'insert, aucun customId définitif ne peut exister
// avant : le premier envoi ne porte AUCUN composant, les boutons sont ajoutés
// par l'édition. Aucun customId invalide n'est donc jamais exposé.

const test = require("node:test");
const assert = require("node:assert/strict");
const { TicketPanelDeliveryService } = require("../services/TicketPanelDeliveryService");
const { InMemoryTicketPanelRepository } = require("../persistence/TicketPanelRepository");

const BTN = (label, extra = {}) => ({ label, emoji: null, style: "primary", category_id: null, support_role_id: null, ...extra });

const DRAFT = {
  categoryId: "111111111111111111",
  supportRoleId: "222222222222222222",
  buttons: [BTN("Support")],
};

/** Transport de test qui journalise l'ordre réel des appels Discord. */
function makeTransport({ failOn = null, missingMessage = false } = {}) {
  const calls = [];
  let nextMessageId = 0;
  return {
    calls,
    sent: [],
    async sendPanel(channelId, view) {
      calls.push("sendPanel");
      if (failOn === "sendPanel") throw new Error("channel_unavailable");
      const message = { id: `msg-${++nextMessageId}` };
      this.sent.push({ channelId, view });
      return message;
    },
    async editPanel(channelId, messageId, view) {
      calls.push("editPanel");
      if (failOn === "editPanel") throw new Error("panel_message_not_found");
      if (missingMessage) throw new Error("panel_message_not_found");
      this.sent.push({ channelId, messageId, view });
      return { id: messageId };
    },
    async deletePanel(channelId, messageId) {
      calls.push("deletePanel");
      return { deleted: true };
    },
  };
}

function makeService({ transport, panelRepository = new InMemoryTicketPanelRepository(), buildResult = null } = {}) {
  return new TicketPanelDeliveryService({
    panelService: {
      build: async ({ panel }) => buildResult
        || (panel
          ? { ready: true, view: { title: "t", content: "d", components: [{ customId: `civrat:v1:tickets:create:${panel.id}:0`, label: "Support" }] } }
          : { ready: true, view: { title: "t", content: "d", components: [{ customId: "civrat:v1:tickets:create", label: "Support" }] } }),
      defaultDraft: async () => DRAFT,
    },
    transport,
    panelRepository,
  });
}

test("ticket panel delivery sends once to the caller-provided text channel when ready", async () => {
  const transport = makeTransport();
  const service = makeService({ transport });
  const result = await service.deliver({ guildId: "g", t: (k) => k, channelId: "text-channel-1", draft: DRAFT });
  assert.equal(result.delivered, true);
  assert.equal(result.channelId, "text-channel-1");
  assert.equal(transport.calls.filter((c) => c === "sendPanel").length, 1, "un seul envoi");
  assert.equal(transport.sent[0].channelId, "text-channel-1");
});

test("ticket panel delivery refuses a missing destination (never falls back to any category)", async () => {
  const transport = makeTransport();
  const service = makeService({ transport });
  const result = await service.deliver({ guildId: "g", t: (k) => k, channelId: null, draft: DRAFT });
  assert.equal(result.delivered, false);
  assert.equal(result.code, "CHANNEL_UNAVAILABLE");
  assert.equal(transport.calls.length, 0, "no destination must mean no send attempt");
});

test("ticket panel delivery skips incomplete configuration", async () => {
  const transport = makeTransport();
  const service = makeService({ transport, buildResult: { ready: false, code: "TICKET_CONFIG_INCOMPLETE" } });
  const result = await service.deliver({ guildId: "g", t: (k) => k, channelId: "text-channel-1", draft: DRAFT });
  assert.equal(result.delivered, false);
  assert.equal(transport.calls.length, 0);
});

test("ticket panel delivery reports TRANSPORT_ERROR when the transport rejects the channel", async () => {
  const transport = makeTransport({ failOn: "sendPanel" });
  const service = makeService({ transport });
  const result = await service.deliver({ guildId: "g", t: (k) => k, channelId: "cat-not-text", draft: DRAFT });
  assert.equal(result.delivered, false);
  assert.equal(result.code, "TRANSPORT_ERROR");
});

// ─────────────────────────────────────────────────────────────────────────
// M8 — persistance et ordre des opérations.
// ─────────────────────────────────────────────────────────────────────────

test("M8: delivery persists the panel and returns its id and messageId", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = makeService({ transport, panelRepository });
  const result = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: DRAFT });

  assert.equal(result.delivered, true);
  assert.ok(result.panelId, "un panelId est retourné");
  assert.equal(result.messageId, "msg-1");

  const stored = await panelRepository.findActive("g", result.panelId);
  assert.ok(stored, "le panel est retrouvé en base");
  assert.equal(stored.channelId, "chan");
  assert.equal(stored.messageId, "msg-1");
  assert.equal(stored.categoryId, DRAFT.categoryId);
  assert.equal(stored.supportRoleId, DRAFT.supportRoleId);
  assert.equal(stored.buttons.length, 1);
});

test("M8: the Discord send happens BEFORE the insert, and buttons only after", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  const order = [];
  const originalCreate = panelRepository.create.bind(panelRepository);
  panelRepository.create = async (panel) => { order.push("insert"); return originalCreate(panel); };

  const service = makeService({ transport, panelRepository });
  const sendPanel = transport.sendPanel.bind(transport);
  transport.sendPanel = async (...args) => { order.push("send"); return sendPanel(...args); };

  await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: DRAFT });
  assert.deepEqual(order, ["send", "insert"], "ordre D-B : send puis insert");
  assert.deepEqual(transport.calls, ["sendPanel", "editPanel"]);
});

test("M8: the first send carries NO component, so no invalid customId is ever exposed", async () => {
  const transport = makeTransport();
  const service = makeService({ transport });
  await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: DRAFT });

  assert.deepEqual(transport.sent[0].view.components, [], "premier envoi sans composant");
  // L'édition, elle, porte le customId définitif avec le vrai panelId.
  const edited = transport.sent[1].view.components;
  assert.equal(edited.length, 1);
  assert.match(edited[0].customId, /^civrat:v1:tickets:create:\d+:0$/);
});

test("M8: an insert failure deletes the message just sent (compensation)", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  panelRepository.create = async () => { throw new Error("insert failed"); };
  const service = makeService({ transport, panelRepository });

  const result = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: DRAFT });
  assert.equal(result.delivered, false);
  assert.equal(result.code, "PERSISTENCE_ERROR");
  assert.deepEqual(transport.calls, ["sendPanel", "deletePanel"], "le message orphelin est retiré");
  assert.equal(await panelRepository.countActive("g"), 0);
});

test("M8: an edit failure deactivates the panel and removes the message", async () => {
  const transport = makeTransport({ failOn: "editPanel" });
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = makeService({ transport, panelRepository });

  const result = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: DRAFT });
  assert.equal(result.delivered, false);
  assert.equal(result.code, "TRANSPORT_ERROR");
  // Aucune ligne ACTIVE ne subsiste : un panel sans message utilisable est mort.
  assert.equal(await panelRepository.countActive("g"), 0);
  // La ligne existe toujours (invalidation, jamais de suppression).
  assert.equal(panelRepository.rows.size, 1);
  assert.equal([...panelRepository.rows.values()][0].is_active, false);
  assert.ok(transport.calls.includes("deletePanel"));
});

test("M8: the 11th active panel is refused before any Discord send", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = makeService({ transport, panelRepository });

  for (let i = 0; i < 10; i += 1) {
    const r = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: DRAFT });
    assert.equal(r.delivered, true, `panel ${i + 1}`);
  }
  assert.equal(await panelRepository.countActive("g"), 10);

  const before = transport.calls.length;
  const eleventh = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: DRAFT });
  assert.equal(eleventh.delivered, false);
  assert.equal(eleventh.code, "PANEL_LIMIT_REACHED");
  assert.equal(transport.calls.length, before, "aucun envoi Discord tenté");
});

test("M8: a draft without any usable button is refused with no send", async () => {
  const transport = makeTransport();
  const service = makeService({ transport });
  const result = await service.deliver({
    guildId: "g", t: (k) => k, channelId: "chan",
    draft: { categoryId: DRAFT.categoryId, supportRoleId: DRAFT.supportRoleId, buttons: [] },
  });
  assert.equal(result.delivered, false);
  assert.equal(result.code, "TICKET_PANEL_NO_BUTTON");
  assert.equal(transport.calls.length, 0);
});

test("M8: deactivation sets is_active=false and removes the message, never deletes the row", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = makeService({ transport, panelRepository });
  const created = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: DRAFT });

  const panel = await panelRepository.findActive("g", created.panelId);
  const result = await service.deactivate({ guildId: "g", panel });
  assert.equal(result.deactivated, true);
  assert.equal(await panelRepository.findActive("g", created.panelId), null, "plus actif");
  assert.equal(panelRepository.rows.size, 1, "la ligne subsiste");
  assert.ok(transport.calls.includes("deletePanel"));

  // Idempotent.
  const again = await service.deactivate({ guildId: "g", panel });
  assert.equal(again.deactivated, false);
});

test("M8: redeliver on a manually deleted message reconciles lazily to is_active=false", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = makeService({ transport, panelRepository });
  const created = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: DRAFT });
  const panel = await panelRepository.findActive("g", created.panelId);

  // Le message a disparu de Discord.
  const broken = makeTransport({ missingMessage: true });
  const brokenService = new TicketPanelDeliveryService({
    panelService: service.panelService, transport: broken, panelRepository,
  });
  const result = await brokenService.redeliver({ guildId: "g", t: (k) => k, panel, updates: { buttons: DRAFT.buttons } });

  assert.equal(result.delivered, false);
  assert.equal(result.code, "TICKET_PANEL_MESSAGE_MISSING");
  assert.equal(await panelRepository.findActive("g", created.panelId), null, "réconcilié : inactif");
});

// ─────────────────────────────────────────────────────────────────────────
// M8 (correctif point 3) — un échec TRANSITOIRE de l'édition Discord ne doit
// pas laisser la base dans le nouvel état pendant que Discord affiche
// l'ancien. L'état précédent est restauré.
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// ⚠️ CHANGEMENT D'ATTENTE — signalé explicitement.
//
// Ces tests verrouillaient l'ordre « base d'abord, Discord ensuite ». Cet ordre
// est INVERSÉ : Discord d'abord, base ensuite. Raison — le customId porte
// l'INDICE du bouton, et un indice hors bornes est refusé strictement. Si la
// base est réduite avant le message, un membre qui clique sur un ancien bouton
// encore affiché tombe sur un refus. En éditant Discord en premier, la base
// contient encore l'ancien état (sur-ensemble en cas de réduction) : tout
// bouton encore visible reste résolvable.
// ─────────────────────────────────────────────────────────────────────────

/** panelService de test dont la vue reflète réellement les boutons du panel. */
function panelServiceReflectingButtons() {
  return {
    build: async ({ panel }) => ({
      ready: true,
      view: { labels: (panel?.buttons || []).map((b) => b.label) },
    }),
    defaultDraft: async () => DRAFT,
  };
}

test("M8: Discord is edited BEFORE the database, so published buttons stay resolvable", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = new TicketPanelDeliveryService({
    panelService: panelServiceReflectingButtons(), transport, panelRepository,
  });
  const created = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: { ...DRAFT, buttons: [BTN("b0"), BTN("b1"), BTN("b2")] } });
  const before = await panelRepository.findActive("g", created.panelId);
  assert.equal(before.buttons.length, 3);

  // On observe la base AU MOMENT de l'édition Discord.
  let buttonsInDbDuringEdit = null;
  const realEdit = transport.editPanel.bind(transport);
  transport.editPanel = async (...args) => {
    buttonsInDbDuringEdit = (await panelRepository.findActive("g", created.panelId)).buttons.length;
    return realEdit(...args);
  };

  // deliver a déjà produit ses propres appels : on ne compte que ceux de redeliver.
  const callsBefore = transport.calls.length;
  const result = await service.redeliver({
    guildId: "g", t: (k) => k, panel: before, updates: { buttons: [BTN("n0")] },
  });

  assert.equal(result.delivered, true);
  assert.equal(buttonsInDbDuringEdit, 3, "au moment de l'édition Discord, la base contient encore les 3 anciens boutons");
  assert.equal((await panelRepository.findActive("g", created.panelId)).buttons.length, 1, "puis la base est réduite");
  const order = transport.calls.slice(callsBefore);
  assert.deepEqual(order, ["editPanel"], "une seule édition Discord, avant la mise à jour en base");
});

test("M8: a transient Discord edit failure leaves the database untouched", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = new TicketPanelDeliveryService({
    panelService: panelServiceReflectingButtons(), transport, panelRepository,
  });
  const created = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: { ...DRAFT, buttons: [BTN("b0"), BTN("b1")] } });
  const before = await panelRepository.findActive("g", created.panelId);

  let updateCalls = 0;
  const realUpdate = panelRepository.updatePanel.bind(panelRepository);
  panelRepository.updatePanel = async (...args) => { updateCalls += 1; return realUpdate(...args); };

  const failing = makeTransport();
  failing.editPanel = async () => { throw new Error("rate_limited"); };
  const failingService = new TicketPanelDeliveryService({
    panelService: panelServiceReflectingButtons(), transport: failing, panelRepository,
  });

  const result = await failingService.redeliver({
    guildId: "g", t: (k) => k, panel: before, updates: { buttons: [BTN("n0")], categoryId: "333333333333333333" },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.code, "TRANSPORT_ERROR");
  assert.equal(updateCalls, 0, "aucune écriture en base quand Discord a échoué");

  const after = await panelRepository.findActive("g", created.panelId);
  assert.equal(after.buttons.length, before.buttons.length, "les boutons précédents subsistent");
  assert.equal(after.buttons[0].label, before.buttons[0].label);
  assert.equal(after.categoryId, before.categoryId, "la catégorie précédente subsiste");
  // Rien n'ayant été écrit, il n'y a rien à remettre en arrière.
  assert.equal(result.details.reverted, undefined);
});

test("M8: when the database update fails, Discord is reverted to the previous state", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = new TicketPanelDeliveryService({
    panelService: panelServiceReflectingButtons(), transport, panelRepository,
  });
  const created = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: { ...DRAFT, buttons: [BTN("b0"), BTN("b1")] } });
  const before = await panelRepository.findActive("g", created.panelId);

  panelRepository.updatePanel = async () => { throw new Error("db_down"); };

  const result = await service.redeliver({
    guildId: "g", t: (k) => k, panel: before, updates: { buttons: [BTN("n0")] },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.details.reverted, true, "le message a été remis dans son état antérieur");

  // La base n'a pas bougé ET le message affiche de nouveau les anciens boutons.
  const after = await panelRepository.findActive("g", created.panelId);
  assert.equal(after.buttons.length, 2, "la base est intacte");
  const lastEdit = [...transport.sent].reverse().find((s) => s.messageId);
  assert.deepEqual(lastEdit.view.labels, ["b0", "b1"], "Discord est revenu à l'état antérieur : base et message concordent");
});

test("M8: when the revert itself fails, the divergence is reported, not hidden", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = new TicketPanelDeliveryService({
    panelService: panelServiceReflectingButtons(), transport, panelRepository,
  });
  const created = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: { ...DRAFT, buttons: [BTN("b0"), BTN("b1")] } });
  const before = await panelRepository.findActive("g", created.panelId);

  // 1re édition réussit (nouvel état), la 2ᵉ (retour arrière) échoue.
  let edits = 0;
  const realEdit = transport.editPanel.bind(transport);
  transport.editPanel = async (...args) => {
    edits += 1;
    if (edits > 1) throw new Error("revert_failed");
    return realEdit(...args);
  };
  panelRepository.updatePanel = async () => { throw new Error("db_down"); };

  const result = await service.redeliver({
    guildId: "g", t: (k) => k, panel: before, updates: { buttons: [BTN("n0")] },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.code, "TICKET_PANEL_STATE_DIVERGENT", "la divergence est signalée par un code distinct");
  assert.equal(result.details.reverted, false);
  // Dégradation bornée : en réduction, Discord affiche MOINS de boutons que la
  // base n'en connaît — tout bouton visible reste donc résolvable.
  assert.equal((await panelRepository.findActive("g", created.panelId)).buttons.length, 2, "la base conserve l'état antérieur");
});

test("M8: a genuinely missing message still deactivates instead of restoring", async () => {
  const transport = makeTransport();
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = makeService({ transport, panelRepository });
  const created = await service.deliver({ guildId: "g", t: (k) => k, channelId: "chan", draft: DRAFT });
  const panel = await panelRepository.findActive("g", created.panelId);

  const broken = makeTransport({ missingMessage: true });
  const brokenService = new TicketPanelDeliveryService({
    panelService: service.panelService, transport: broken, panelRepository,
  });
  const result = await brokenService.redeliver({ guildId: "g", t: (k) => k, panel, updates: { buttons: [BTN("n0")] } });
  assert.equal(result.code, "TICKET_PANEL_MESSAGE_MISSING");
  assert.equal(await panelRepository.findActive("g", created.panelId), null, "pas de restauration : le panel est mort");
  assert.equal(panelRepository.rows.size, 1, "mais la ligne subsiste");
});
