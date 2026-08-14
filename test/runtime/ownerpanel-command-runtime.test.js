"use strict";

// P20 — intégration runtime de /ownerpanel : ouverture publique contrôlée
// dynamiquement, routes d'action protégées par PermissionName.CIVRAT_OWNER
// (couture core), composition complète des commandes, i18n EN/FR. Hors ligne :
// contexte simulé, aucune connexion Discord/Supabase.

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../src/core/interactions");
const { PermissionName } = require("../../src/core/permissions");
const { registerOwnerPanel } = require("../../src/modules/owner-panel/register");
const { OwnerPanelComponentId: Id, OwnerPanelFieldId: Field } = require("../../src/modules/owner-panel/configuration/ownerPanelConstants");
const routes = require("../../src/modules/owner-panel/interactions/ownerPanelRoutes");
const fr = require("../../src/modules/owner-panel/translations/fr.json");
const en = require("../../src/modules/owner-panel/translations/en.json");

const translate = (dict) => (key, vars) => {
  const raw = key.split(".").reduce((v, s) => (v ? v[s] : undefined), dict);
  return typeof raw === "string" ? raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, n) => String(vars?.[n] ?? "")) : raw;
};

const COMPONENT_ROUTES = [
  ["modal", Id.MASTER_SUBMIT, false],
  ["button", Id.ADD_ADMIN, true],
  ["button", Id.REMOVE_ADMIN, true],
  ["button", Id.TRANSFER, true],
  ["modal", Id.ADD_ADMIN_SUBMIT, true],
  ["modal", Id.REMOVE_ADMIN_SUBMIT, true],
  ["modal", Id.TRANSFER_SUBMIT, true],
  ["button", Id.CONFIRM, true],
  ["button", Id.CANCEL, true],
];

// P20.1 — canal de récupération : routes publiques DONT la garde est
// l'élévation Recovery revérifiée dans chaque handler (jamais CIVRAT_OWNER).
const RECOVERY_ROUTES = [
  ["button", Id.RECOVERY_MASTER],
  ["button", Id.RECOVERY_TRANSFER],
  ["modal", Id.RECOVERY_TRANSFER_SUBMIT],
  ["button", Id.RECOVERY_CONFIRM],
  ["button", Id.RECOVERY_CANCEL],
];

test("ownerpanel command is public; action routes require CIVRAT_OWNER", () => {
  const registry = new InteractionRegistry();
  const { commands } = registerOwnerPanel({ registry, runtimeFactory: () => ({}) });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, "ownerpanel");
  assert.deepEqual(commands[0].permissions.allOf, [], "open by design — content is gated dynamically");
  for (const [kind, customId, ownerOnly] of COMPONENT_ROUTES) {
    const route = registry.find({ kind, customId });
    assert.ok(route, `route registered: ${customId}`);
    if (ownerOnly) {
      assert.deepEqual(route.permissions.allOf, [PermissionName.CIVRAT_OWNER], `${customId} is owner-only`);
    } else {
      assert.deepEqual(route.permissions.allOf, [], `${customId} stays open (rights re-checked inside)`);
    }
  }
  for (const [kind, customId] of RECOVERY_ROUTES) {
    const route = registry.find({ kind, customId });
    assert.ok(route, `recovery route registered: ${customId}`);
    assert.deepEqual(route.permissions.allOf, [], `${customId} gated by active recovery elevation inside, never CIVRAT_OWNER`);
  }
});

test("recovery channel: elevated user sees the transfer modal with empty fields", async () => {
  const f = makeRuntime();
  f.hasRecoveryElevation = () => true;
  const { context, state } = makeContext({ userId: "u" });
  await routes.openRecoveryTransfer(context, f);
  assert.equal(state.modals[0].customId, Id.RECOVERY_TRANSFER_SUBMIT);
  assert.deepEqual(state.modals[0].fields.map((field) => field.id), [Field.TRANSFER_CODE, Field.NEW_OWNER_ID]);
  assert.ok(state.modals[0].fields.every((field) => field.value === ""), "no secret ever prefilled");
  // Sans élévation : refus générique même sur ce canal.
  const denied = makeContext({ userId: "u" });
  await routes.openRecoveryTransfer(denied.context, makeRuntime());
  assert.equal(denied.state.modals.length, 0);
  assert.equal(denied.state.replies[0].view.content, fr.ownerpanel.refused);
});

test("full runtime composition exposes /ownerpanel (22 modular commands, 24 total)", () => {
  const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
  const runtime = createGuildSettingsRuntime({
    legacyConfigService: { getGuildConfig: async () => ({}), updateGuildConfig: async () => ({}), invalidateCache: async () => {} },
  });
  const names = runtime.getDiscordCommands().map((c) => c.data.name);
  assert.ok(names.includes("ownerpanel"));
  assert.ok(names.includes("recovery"));
  assert.equal(names.length, 22, "20 modules historiques + recovery + ownerpanel");
  assert.equal(new Set(names).size, names.length, "aucune duplique");
});

function makeRuntime({ canOpenUser = true, viewerIsOwner = false } = {}) {
  const sessions = new Set();
  return {
    identity: {
      isOwnerOrAdmin: async () => canOpenUser,
      isOwner: async () => viewerIsOwner,
      // Admin = peut ouvrir sans être Owner (accès permanent, sans code).
      isAdmin: async () => canOpenUser && !viewerIsOwner,
      getOwnerId: async () => "111111111111111111",
      listAdminIds: async () => ["222222222222222222"],
    },
    panel: {
      tryAuthenticate: (_u, code) => (code === "fake-panel-code-for-tests" ? (sessions.add(_u), { ok: true }) : { ok: false }),
      authenticate: (u) => sessions.has(u),
    },
    hasRecoveryElevation: () => false,
  };
}

function makeContext({ userId = "u", modalValues = {}, locale = fr } = {}) {
  const state = { replies: [], modals: [], updates: [] };
  const context = {
    guildId: "g",
    userId,
    t: translate(locale),
    envelope: {
      modalValues,
      transport: {
        reply: async (payload) => { state.replies.push(payload); },
        update: async (payload) => { state.updates.push(payload); },
        showModal: async (modal) => { state.modals.push(modal); },
      },
    },
  };
  return { context, state };
}

test("open: owner gets the master modal, admin gets direct read-only access, outsiders refused", async () => {
  // Owner → modale Master Code (authentification obligatoire, session 24 h).
  const owner = makeContext({ userId: "owner" });
  await routes.openOwnerPanel(owner.context, makeRuntime({ viewerIsOwner: true }));
  const modal = owner.state.modals[0];
  assert.equal(modal.customId, Id.MASTER_SUBMIT);
  assert.equal(modal.fields[0].id, Field.MASTER);
  assert.equal(modal.fields[0].value, "", "master field never prefilled");

  // Admin → accès direct (aucune modale, aucun code), vue lecture seule.
  const admin = makeContext({ userId: "admin" });
  await routes.openOwnerPanel(admin.context, makeRuntime({ viewerIsOwner: false }));
  assert.equal(admin.state.modals.length, 0);
  assert.equal(admin.state.replies.length, 1);
  assert.equal(admin.state.replies[0].ephemeral, true);
  assert.deepEqual(admin.state.replies[0].view.components, [], "admin has no action buttons");

  // Membre sans rien → refus générique éphémère.
  const denied = makeContext();
  await routes.openOwnerPanel(denied.context, makeRuntime({ canOpenUser: false }));
  assert.equal(denied.state.modals.length, 0);
  assert.equal(denied.state.replies[0].ephemeral, true);
  assert.equal(denied.state.replies[0].view.content, fr.ownerpanel.refused);
});

test("master submit: fr copy, owner sees buttons, admin read-only, wrong code generic", async () => {
  // Owner : vue avec les 3 actions.
  const owner = makeContext({ userId: "owner", modalValues: { [Field.MASTER]: "fake-panel-code-for-tests" } });
  await routes.submitMasterCode(owner.context, makeRuntime({ viewerIsOwner: true }));
  assert.equal(owner.state.replies[0].view.components.length, 4);
  assert.ok(owner.state.replies[0].view.content.includes("111111111111111111"));
  // Admin : lecture seule.
  const admin = makeContext({ userId: "admin", modalValues: { [Field.MASTER]: "fake-panel-code-for-tests" } });
  await routes.submitMasterCode(admin.context, makeRuntime({ viewerIsOwner: false }));
  assert.deepEqual(admin.state.replies[0].view.components, []);
  assert.ok(admin.state.replies[0].view.content.includes("lecture seule"));
  // Mauvais code : générique, sans rien révéler.
  const wrong = makeContext({ modalValues: { [Field.MASTER]: "nope" } });
  await routes.submitMasterCode(wrong.context, makeRuntime());
  assert.equal(wrong.state.replies[0].view.content, fr.ownerpanel.refused);
});

test("transfer modal asks code + new id, both fields empty", async () => {
  const f = makeRuntime();
  f.panel.tryAuthenticate("u", "fake-panel-code-for-tests");
  const { context, state } = makeContext({ userId: "u" });
  await routes.openTransfer(context, f);
  const modal = state.modals[0];
  assert.equal(modal.customId, Id.TRANSFER_SUBMIT);
  assert.deepEqual(modal.fields.map((field) => field.id), [Field.TRANSFER_CODE, Field.NEW_OWNER_ID]);
  assert.ok(modal.fields.every((field) => field.value === ""), "no secret ever prefilled");
});

test("ownerpanel translations exist in EN and FR with identical key sets", () => {
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
  assert.deepEqual(flat(en).sort(), flat(fr).sort());
  assert.equal(en.ownerpanel.title, "👑 CIVRAT Owner panel");
  assert.equal(fr.ownerpanel.title, "👑 Panneau propriétaire CIVRAT");
});
