"use strict";

// P20 — intégration runtime de /recovery : commande publique, routes modales
// branchées, anti-oracle (même réponse publique quel que soit le résultat du
// Master Code), i18n EN/FR. Hors ligne : contexte et service simulés, aucune
// connexion Discord/Supabase/Brevo.

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../src/core/interactions");
const { registerRecovery } = require("../../src/modules/recovery/register");
const { RecoveryComponentId: Id, RecoveryFieldId: Field } = require("../../src/modules/recovery/configuration/recoveryConstants");
const { startRecovery, submitMaster, submitCode } = require("../../src/modules/recovery/interactions/recoveryRoutes");
const fr = require("../../src/modules/recovery/translations/fr.json");
const en = require("../../src/modules/recovery/translations/en.json");

const translate = (dict) => (key) => key.split(".").reduce((v, s) => v[s], dict);

test("recovery command and routes are registered public (no permission)", () => {
  const registry = new InteractionRegistry();
  const { commands } = registerRecovery({ registry, serviceFactory: () => ({}) });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, "recovery");
  assert.deepEqual(commands[0].permissions.allOf, [], "public by design");
  assert.ok(registry.find({ kind: "button", customId: Id.ENTER_CODE }));
  assert.ok(registry.find({ kind: "modal", customId: Id.MASTER_SUBMIT }));
  assert.ok(registry.find({ kind: "modal", customId: Id.CODE_SUBMIT }));
});

test("full runtime composition exposes /recovery (22 modular commands, 24 total)", () => {
  const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
  const runtime = createGuildSettingsRuntime({
    legacyConfigService: { getGuildConfig: async () => ({}), updateGuildConfig: async () => ({}), invalidateCache: async () => {} },
  });
  const names = runtime.getDiscordCommands().map((c) => c.data.name);
  assert.ok(names.includes("recovery"));
  assert.equal(names.length, 22, "20 modules historiques + recovery + ownerpanel");
  assert.equal(new Set(names).size, names.length, "aucune duplique");
});

function makeContext({ modalValues = {}, locale = fr } = {}) {
  const state = { replies: [], modals: [] };
  const context = {
    guildId: "g",
    userId: "u",
    t: translate(locale),
    envelope: {
      modalValues,
      transport: {
        reply: async (payload) => { state.replies.push(payload); },
        showModal: async (modal) => { state.modals.push(modal); },
      },
    },
  };
  return { context, state };
}

test("/recovery opens the master modal (empty field, no prefilled secret)", async () => {
  const { context, state } = makeContext();
  await startRecovery(context);
  const modal = state.modals[0];
  assert.equal(modal.customId, Id.MASTER_SUBMIT);
  assert.equal(modal.fields[0].id, Field.MASTER);
  assert.equal(modal.fields[0].value, "", "master field never prefilled");
  assert.equal(modal.title, "Récupération propriétaire");
});

test("master submit ALWAYS answers the same generic view (anti-oracle)", async () => {
  const outcomes = [
    { requestRecovery: async () => ({ sent: true, code: "RECOVERY_CODE_SENT" }) },
    { requestRecovery: async () => ({ sent: false, code: "RECOVERY_MASTER_INVALID" }) },
    { requestRecovery: async () => ({ sent: false, code: "RECOVERY_UNAVAILABLE" }) },
  ];
  const replies = [];
  for (const service of outcomes) {
    const { context, state } = makeContext({ modalValues: { [Field.MASTER]: "x" } });
    await submitMaster(context, service);
    replies.push(state.replies[0]);
  }
  const [first, ...rest] = replies.map((r) => JSON.stringify(r.view));
  for (const other of rest) assert.equal(other, first, "public answer must not reveal master validity");
  assert.ok(replies.every((r) => r.ephemeral), "all recovery replies are ephemeral");
  assert.ok(first.includes("Si vos informations sont valides"), "generic FR copy");
});

test("code submit is binary: verified vs generic refusal (no detailed leak)", async () => {
  const okService = { verifyRecovery: async () => ({ recovered: true, code: "RECOVERY_VERIFIED" }) };
  const koService = { verifyRecovery: async () => ({ recovered: false, code: "RECOVERY_CODE_EXPIRED" }) };
  const ok = makeContext({ modalValues: { [Field.TEMP_CODE]: "123456" }, locale: en });
  await submitCode(ok.context, okService);
  assert.equal(ok.state.replies[0].view.content, "✅ Recovery validated.");
  const ko = makeContext({ modalValues: { [Field.TEMP_CODE]: "123456" }, locale: en });
  await submitCode(ko.context, koService);
  assert.equal(ko.state.replies[0].view.content, "❌ Recovery refused: the code is invalid, expired or already used.");
});

test("recovery translations exist in EN and FR with identical key sets", () => {
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
  assert.deepEqual(flat(en).sort(), flat(fr).sort());
  assert.equal(en.recovery.title, "🔐 Owner recovery");
  assert.equal(fr.recovery.title, "🔐 Récupération propriétaire");
});
