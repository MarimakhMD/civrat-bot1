"use strict";

// Phase 10.2 — panneau Tickets Premium : application des personnalisations
// uniquement avec entitlement actif, vue verrouillée sinon, validation des
// saisies, aperçu fidèle, et non-régression du panneau Free historique.
// Hors ligne : repository d'entitlement simulé, aucun accès Discord/Supabase.

const test = require("node:test");
const assert = require("node:assert/strict");
const { EntitlementService } = require("../../../core/entitlements");
const { toActionRows } = require("../../../adapters/discord/DiscordResponseTransport");
const { TicketPanelService } = require("../services/TicketPanelService");
const { TicketPremiumConfigResolver } = require("../services/TicketPremiumConfigResolver");
const { TicketPremiumConfigKey: PKey } = require("../configuration/ticketPremiumConstants");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { ticketView } = require("../interactions/ticketViews");
const {
  premiumLockedView,
  premiumPanelView,
  openPremiumPanel,
  openPremiumPanelModal,
  submitPremiumPanel,
  resetPremiumPanel,
  previewPremiumPanel,
} = require("../interactions/premiumPanel");

const freeConfig = { tickets_enabled: true, ticket_category_id: "cat", ticket_support_role_id: "role" };
const premiumValues = {
  [PKey.PANEL_TITLE]: "Support Élite",
  [PKey.PANEL_DESCRIPTION]: "Décris ton problème en détail.",
  [PKey.PANEL_COLOR]: "#8061ef",
  [PKey.PANEL_IMAGE_URL]: "https://cdn.example.com/panel.png",
  [PKey.CREATE_BUTTON_LABEL]: "📩 Contacter",
};

const ACTIVE = { status: "active", ends_at: null };
const EXPIRED = { status: "active", ends_at: "2020-01-01T00:00:00.000Z" };
const INACTIVE = { status: "revoked", ends_at: null };

function makeResolver(record) {
  const repository = { findFeature: async () => record };
  return new TicketPremiumConfigResolver({ entitlementService: new EntitlementService({ repository }) });
}

function makeContext({ config = { ...freeConfig }, record = ACTIVE, modalValues = null } = {}) {
  const state = { config, writes: [], views: [], replies: [], embeds: [], modals: [] };
  const service = {
    read: async () => state.config,
    update: async (_g, updates) => { state.writes.push(updates); state.config = { ...state.config, ...updates }; return state.config; },
  };
  const context = {
    guildId: "g",
    t: (key) => key,
    service,
    premiumConfigResolver: makeResolver(record),
    envelope: {
      modalValues,
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

function buildPanel({ config, record }) {
  const service = new TicketPanelService({ configService: { read: async () => config }, premiumConfigResolver: record === undefined ? null : makeResolver(record) });
  return service.build("g", (key) => key);
}

const historicalFreeView = {
  title: "tickets.panelTitle",
  content: "tickets.panelDescription",
  components: [{ type: "button", customId: Id.CREATE, label: "tickets.create", style: "primary" }],
};

test("Free panel without resolver stays exactly the historical panel", async () => {
  const panel = await buildPanel({ config: { ...freeConfig } });
  assert.equal(panel.ready, true);
  assert.equal(panel.channelId, "cat");
  assert.deepEqual(panel.view, historicalFreeView);
  assert.equal("embed" in panel.view, false);
});

test("no Premium leak: inactive entitlement with stored Premium values keeps the historical panel", async () => {
  const panel = await buildPanel({ config: { ...freeConfig, ...premiumValues }, record: INACTIVE });
  assert.deepEqual(panel.view, historicalFreeView);
  assert.equal("embed" in panel.view, false);
});

test("expired entitlement falls back to the historical Free panel", async () => {
  const panel = await buildPanel({ config: { ...freeConfig, ...premiumValues }, record: EXPIRED });
  assert.deepEqual(panel.view, historicalFreeView);
  assert.equal("embed" in panel.view, false);
});

test("active Premium applies title, description, button label, color and image", async () => {
  const panel = await buildPanel({ config: { ...freeConfig, ...premiumValues }, record: ACTIVE });
  assert.equal(panel.view.title, "Support Élite");
  assert.equal(panel.view.content, "Décris ton problème en détail.");
  assert.deepEqual(panel.view.embed, { color: "#8061ef", image: "https://cdn.example.com/panel.png" });
  assert.equal(panel.view.components[0].label, "📩 Contacter");
  assert.equal(panel.view.components[0].customId, Id.CREATE);
  assert.equal(panel.channelId, "cat");
});

test("active Premium without image falls back cleanly (Free texts, embed without image)", async () => {
  const panel = await buildPanel({ config: { ...freeConfig, [PKey.PANEL_COLOR]: "#123456" }, record: ACTIVE });
  assert.equal(panel.view.title, "tickets.panelTitle");
  assert.equal(panel.view.content, "tickets.panelDescription");
  assert.equal(panel.view.components[0].label, "tickets.create");
  assert.deepEqual(panel.view.embed, { color: "#123456", image: null });
});

test("invalid stored Premium values fall back per key even when active", async () => {
  const panel = await buildPanel({
    config: { ...freeConfig, [PKey.PANEL_COLOR]: "blue", [PKey.PANEL_TITLE]: "Titre custom" },
    record: ACTIVE,
  });
  assert.equal(panel.view.title, "Titre custom");
  assert.equal("embed" in panel.view, false);
});

test("tickets settings view exposes the Premium entry and stays within Discord limits", () => {
  const view = ticketView({ t: (key) => key, config: { tickets_enabled: true } });
  const json = JSON.stringify(view.components);
  for (const id of [Id.TOGGLE, Id.CATEGORY, Id.SUPPORT_ROLE, Id.PREMIUM_SECTION, Id.PREVIEW, Id.BACK]) {
    assert.ok(json.includes(id), `tickets view is missing ${id}`);
  }
  const rows = toActionRows(view.components);
  assert.ok(rows.length <= 5, `tickets view renders ${rows.length} rows`);
});

test("locked view exposes no usable Premium control, only Back", () => {
  const view = premiumLockedView({ t: (key) => key });
  assert.equal(view.components.length, 1);
  assert.equal(view.components[0].customId, Id.PANEL);
  const json = JSON.stringify(view.components);
  assert.equal(json.includes(Id.PREMIUM_EDIT), false);
  assert.equal(json.includes(Id.PREMIUM_RESET), false);
});

test("active sub-view shows resolved state and its 8 controls within Discord limits", () => {
  const view = premiumPanelView({ t: (key) => key, premium: { ...premiumValues } });
  assert.deepEqual(
    view.components.map((c) => c.customId),
    [Id.PREMIUM_EDIT, Id.PREMIUM_PREVIEW, Id.PREMIUM_EDIT_WELCOME, Id.PREMIUM_PREVIEW_WELCOME, Id.PREMIUM_EDIT_FORMAT, Id.PREMIUM_RESET, Id.PREMIUM_TRANSCRIPT, Id.PANEL],
  );
  const rows = toActionRows(view.components);
  assert.ok(rows.length <= 5, `premium sub-view renders ${rows.length} rows`);
  assert.ok(rows[0].components.length <= 5);
  assert.ok(view.content.includes("Support Élite"));
  assert.ok(view.content.includes("tickets.premiumFieldWelcomeMessage")); // nouvelle ligne d'état (10.3)
  assert.ok(view.content.includes("tickets.premiumPlaceholdersHelp"));
  const empty = premiumPanelView({ t: (key) => key, premium: {} });
  assert.ok(empty.content.includes("tickets.premiumStateDefault"));
  const withTranscript = premiumPanelView({ t: (key) => key, premium: { [PKey.TRANSCRIPT_CHANNEL_ID]: "123456789012345678" } });
  assert.ok(withTranscript.content.includes("<#123456789012345678>"));
});

test("premium section renders the locked view when the entitlement is inactive", async () => {
  const { context, state } = makeContext({ record: INACTIVE, config: { ...freeConfig, ...premiumValues } });
  await openPremiumPanel(context);
  assert.equal(state.views.length, 1);
  assert.equal(state.views[0].components.length, 1);
  assert.equal(state.views[0].components[0].customId, Id.PANEL);
  assert.equal(state.writes.length, 0);
});

test("premium section lists resolved values when the entitlement is active", async () => {
  const { context, state } = makeContext({ config: { ...freeConfig, [PKey.PANEL_TITLE]: "Mon titre" } });
  await openPremiumPanel(context);
  assert.equal(state.views[0].components.length, 8); // 6 boutons + select transcript + retour (10.4)
  assert.ok(state.views[0].content.includes("Mon titre"));
});

test("edit opens a 5-field modal with prefilled values, optional fields and paragraph description", async () => {
  const { context, state } = makeContext({ config: { ...freeConfig, ...premiumValues } });
  await openPremiumPanelModal(context);
  const modal = state.modals[0];
  assert.equal(modal.customId, Id.PREMIUM_EDIT_SUBMIT);
  assert.equal(modal.fields.length, 5);
  assert.deepEqual(modal.fields.map((f) => f.id), ["panel_title", "panel_description", "panel_color", "panel_image_url", "panel_button_label"]);
  assert.equal(modal.fields.find((f) => f.id === "panel_description").style, "paragraph");
  assert.ok(modal.fields.every((f) => f.required === false));
  assert.equal(modal.fields[0].value, "Support Élite");
  assert.equal(modal.fields[2].value, "#8061ef");
});

test("submit persists each modification (trimmed, empty field = Free fallback) and re-renders", async () => {
  const { context, state } = makeContext({
    modalValues: { panel_title: "  Mon titre  ", panel_description: "", panel_color: " #ABCDEF ", panel_image_url: "https://cdn.ex.com/i.png", panel_button_label: "Ouvrir un ticket" },
  });
  const result = await submitPremiumPanel(context);
  assert.equal(result.saved, true);
  assert.deepEqual(state.writes[0], {
    [PKey.PANEL_TITLE]: "Mon titre",
    [PKey.PANEL_DESCRIPTION]: null,
    [PKey.PANEL_COLOR]: "#ABCDEF",
    [PKey.PANEL_IMAGE_URL]: "https://cdn.ex.com/i.png",
    [PKey.CREATE_BUTTON_LABEL]: "Ouvrir un ticket",
  });
  assert.ok(state.views[0].content.includes("tickets.premiumSaved"));
  assert.ok(state.views[0].content.includes("Mon titre"));
  assert.ok(state.views[0].content.includes("tickets.premiumStateDefault")); // description revenue au défaut Free
});

test("submit rejects invalid values without writing anything", async () => {
  const { context, state } = makeContext({
    modalValues: { panel_title: "Ok", panel_description: "Ok", panel_color: "blue", panel_image_url: "", panel_button_label: "Ok" },
  });
  const result = await submitPremiumPanel(context);
  assert.equal(result.saved, false);
  assert.equal(state.writes.length, 0);
  assert.equal(state.replies[0].view.content, "tickets.premiumErrorColor");
  assert.equal(state.replies[0].ephemeral, true);
});

test("submit and reset are refused without an active entitlement, even with valid input", async () => {
  const { context, state } = makeContext({
    record: INACTIVE,
    modalValues: { panel_title: "Titre", panel_description: "", panel_color: "", panel_image_url: "", panel_button_label: "" },
  });
  await submitPremiumPanel(context);
  await resetPremiumPanel(context);
  assert.equal(state.writes.length, 0);
  assert.equal(state.views.length, 2); // deux vues verrouillées rendues
  assert.ok(state.views.every((view) => view.components.length === 1));
});

test("reset writes null on the 8 premium keys (panel + content + naming) and announces the Free fallback", async () => {
  const { context, state } = makeContext({ config: { ...freeConfig, ...premiumValues } });
  await resetPremiumPanel(context);
  assert.deepEqual(state.writes[0], {
    [PKey.PANEL_TITLE]: null,
    [PKey.PANEL_DESCRIPTION]: null,
    [PKey.PANEL_COLOR]: null,
    [PKey.PANEL_IMAGE_URL]: null,
    [PKey.CREATE_BUTTON_LABEL]: null,
    [PKey.WELCOME_MESSAGE]: null,
    [PKey.TRANSCRIPT_CHANNEL_ID]: null,
    [PKey.NAME_FORMAT]: null,
  });
  assert.ok(state.views[0].content.includes("tickets.premiumResetDone"));
});

test("preview renders the real panel embed ephemerally, clean when no Premium value is set", async () => {
  const customized = makeContext({ config: { ...freeConfig, [PKey.PANEL_COLOR]: "#123456" } });
  const panel = await previewPremiumPanel(customized.context);
  assert.equal(panel.ready, true);
  const sent = customized.state.embeds[0];
  assert.equal(sent.ephemeral, true);
  assert.deepEqual(sent.embed, { title: "tickets.panelTitle", description: "tickets.panelDescription", color: "#123456", image: null });
  assert.equal(sent.components[0].customId, Id.CREATE);

  const disabled = makeContext({ config: { tickets_enabled: false } });
  await previewPremiumPanel(disabled.context);
  assert.equal(disabled.state.embeds.length, 0);
  assert.equal(disabled.state.replies[0].view.content, "tickets.TICKETS_DISABLED");
});
