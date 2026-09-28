"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAutoModRuntime } = require("../runtime/createAutoModRuntime");
const { AutoModDetectionService } = require("../services/AutoModDetectionService");
const { AutoModEnforcementService } = require("../services/AutoModEnforcementService");

// ────────────────────────────────────────────────────────────────────────────
// PHASE 3.1 (P1) — AutoMod doit aussi s'appliquer aux ÉDITIONS de message,
// sans double sanction ni gonflement artificiel du compteur de spam.
// ────────────────────────────────────────────────────────────────────────────

const GUILD = "guild-1";
const AUTHOR = "user-1";

function makeClock() {
  let now = 1_000_000;
  return { clock: () => now, advance: (ms) => (now += ms) };
}

function makeMessage({ id = "m1", content = "", bot = false, admin = false, manageMessages = false } = {}) {
  return {
    id,
    guild: { id: GUILD },
    author: { id: AUTHOR, bot },
    member: { permissions: { has: (name) => (name === "Administrator" ? admin : name === "ManageMessages" ? manageMessages : false) } },
    content,
    mentions: { users: { size: 0 } },
    partial: false,
  };
}

function makeHarness({ config, throwOnDelete = false } = {}) {
  const { clock, advance } = makeClock();
  const enforcerCalls = { deleted: [], timeouts: [], warns: [] };
  const moderationLogs = [];
  const enforcer = {
    deleteMessage: async (message) => {
      if (throwOnDelete) throw new Error("Discord refused deletion");
      enforcerCalls.deleted.push(message.id);
    },
    timeoutUser: async (o) => { enforcerCalls.timeouts.push(o); return { ok: true }; },
    warnUser: async (o) => { enforcerCalls.warns.push(o); return { ok: true }; },
  };
  const runtime = createAutoModRuntime({
    configService: { read: async () => ({ automod_enabled: true, ...config }) },
    detection: new AutoModDetectionService({ clock }),
    enforcementService: new AutoModEnforcementService({ logger: { warn: () => {} } }),
    enforcerFactory: () => enforcer,
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => moderationLogs.push(e) }),
  });
  return { runtime, enforcerCalls, moderationLogs, advance, detector: runtime };
}

test("1. messageCreate contenu interdit → comportement actuel inchangé", async () => {
  const h = makeHarness({ config: { automod_anti_links: true, automod_delete_message: true } });
  const result = await h.runtime.handleMessage(makeMessage({ id: "c1", content: "va sur https://evil.example" }));
  assert.equal(result.matched, true);
  assert.equal(result.code, "AUTOMOD_LINK");
  assert.deepEqual(h.enforcerCalls.deleted, ["c1"], "le message créé est supprimé");
  assert.equal(h.moderationLogs.length, 1, "un seul log de modération");
});

test("2. messageUpdate vers contenu interdit → détecté et sanctionné", async () => {
  const h = makeHarness({ config: { automod_anti_links: true, automod_delete_message: true } });
  // Création propre : aucune sanction.
  const created = await h.runtime.handleMessage(makeMessage({ id: "e1", content: "bonjour" }));
  assert.equal(created.matched, false);
  assert.equal(h.enforcerCalls.deleted.length, 0);
  // Édition vers un lien : détection + suppression.
  const edited = await h.runtime.handleMessageEdited(makeMessage({ id: "e1", content: "bonjour" }), makeMessage({ id: "e1", content: "lien https://evil.example" }));
  assert.equal(edited.matched, true);
  assert.equal(edited.code, "AUTOMOD_LINK");
  assert.deepEqual(h.enforcerCalls.deleted, ["e1"]);
  assert.equal(h.moderationLogs.length, 1);
});

test("3. messageUpdate vers contenu autorisé → aucune sanction", async () => {
  const h = makeHarness({ config: { automod_anti_links: true, automod_delete_message: true } });
  await h.runtime.handleMessage(makeMessage({ id: "a1", content: "bonjour" }));
  const edited = await h.runtime.handleMessageEdited(makeMessage({ id: "a1", content: "bonjour" }), makeMessage({ id: "a1", content: "bonjour tout le monde" }));
  assert.equal(edited.matched, false);
  assert.equal(h.enforcerCalls.deleted.length, 0, "aucune suppression");
  assert.equal(h.moderationLogs.length, 0, "aucun log");
});

test("4a. double événement pour la même édition → pas de double traitement", async () => {
  const h = makeHarness({ config: { automod_anti_links: true, automod_delete_message: true } });
  const clean = makeMessage({ id: "d1", content: "propre" });
  const bad = makeMessage({ id: "d1", content: "https://evil.example" });
  const first = await h.runtime.handleMessageEdited(clean, bad);
  assert.equal(first.matched, true, "l'édition vers contenu interdit est sanctionnée");
  // Second passage : ancien et nouveau identiques → ignoré.
  const second = await h.runtime.handleMessageEdited(bad, bad);
  assert.equal(second.matched, false, "le second passage (contenu inchangé) est ignoré");
  assert.equal(h.moderationLogs.length, 1, "une seule sanction/log au total");
});

test("partiels : update partiel/secondaire à contenu inchangé → aucune exécution, aucune sanction", async () => {
  const h = makeHarness({ config: { automod_anti_links: true, automod_delete_message: true } });
  const complete = makeMessage({ id: "p1", content: "https://evil.example" });

  // old partial, new complet (contenu inchangé portant un lien) → abstention.
  const oldPartial = await h.runtime.handleMessageEdited({ ...complete, partial: true }, complete);
  assert.equal(oldPartial.matched, false, "old partial → ignoré, pas de re-sanction");

  // new partial → abstention.
  const newPartial = await h.runtime.handleMessageEdited(complete, { ...complete, partial: true });
  assert.equal(newPartial.matched, false, "new partial → ignoré");

  // les deux partiels → abstention.
  const bothPartial = await h.runtime.handleMessageEdited({ ...complete, partial: true }, { ...complete, partial: true });
  assert.equal(bothPartial.matched, false, "les deux partiels → ignoré");

  // old absent (null) → abstention.
  const noOld = await h.runtime.handleMessageEdited(null, complete);
  assert.equal(noOld.matched, false, "old absent → ignoré");

  assert.equal(h.enforcerCalls.deleted.length, 0, "aucune suppression sur cas partiels");
  assert.equal(h.moderationLogs.length, 0, "aucun log sur cas partiels");

  // Contrôle : les deux complets + changement réel → toujours détecté.
  const real = await h.runtime.handleMessageEdited(makeMessage({ id: "p2", content: "propre" }), makeMessage({ id: "p2", content: "https://evil.example" }));
  assert.equal(real.matched, true, "les deux complets + contenu modifié → détecté");
  assert.equal(h.enforcerCalls.deleted.length, 1, "une seule suppression (le cas réel)");
  assert.equal(h.moderationLogs.length, 1);
});

test("4b. plusieurs edits rapides d'un même message → le compteur spam ne gonfle pas", async () => {
  const h = makeHarness({ config: { automod_anti_spam: true, automod_delete_message: false } });
  const base = makeMessage({ id: "s1", content: "message initial" });
  await h.runtime.handleMessage(base);
  // Cinq éditions rapides (contenus différents, tous autorisés) : le message ne
  // doit compter qu'UNE fois dans la fenêtre de spam.
  for (let i = 1; i <= 5; i++) {
    const r = await h.runtime.handleMessageEdited(makeMessage({ id: "s1", content: `edit ${i - 1}` }), makeMessage({ id: "s1", content: `edit ${i}` }));
    assert.equal(r.code === "AUTOMOD_SPAM", false, `l'édition ${i} ne doit pas déclencher SPAM`);
  }
  assert.equal(h.enforcerCalls.deleted.length, 0);
});

test("4c. contrôle : cinq créations distinctes déclenchent bien SPAM", async () => {
  const h = makeHarness({ config: { automod_anti_spam: true, automod_delete_message: false } });
  let spam = false;
  for (let i = 1; i <= 5; i++) {
    const r = await h.runtime.handleMessage(makeMessage({ id: `sp${i}`, content: `message ${i}` }));
    if (r.code === "AUTOMOD_SPAM") spam = true;
  }
  assert.equal(spam, true, "cinq messages distincts dans la fenêtre = SPAM (comportement legacy conservé)");
});

test("5. exemptions bots/admins inchangées sur messageUpdate", async () => {
  const h = makeHarness({ config: { automod_anti_links: true } });
  const botEdit = await h.runtime.handleMessageEdited(makeMessage({ id: "b1", content: "x", bot: true }), makeMessage({ id: "b1", content: "https://evil.example", bot: true }));
  assert.equal(botEdit.matched, false, "bot ignoré");
  const adminEdit = await h.runtime.handleMessageEdited(makeMessage({ id: "b2", content: "x", admin: true }), makeMessage({ id: "b2", content: "https://evil.example", admin: true }));
  assert.equal(adminEdit.matched, false, "admin ignoré");
  const mmEdit = await h.runtime.handleMessageEdited(makeMessage({ id: "b3", content: "x", manageMessages: true }), makeMessage({ id: "b3", content: "https://evil.example", manageMessages: true }));
  assert.equal(mmEdit.matched, false, "ManageMessages ignoré");
  assert.equal(h.moderationLogs.length, 0);
});

test("6. erreur Discord pendant la sanction sur édition → non bloquant", async () => {
  const h = makeHarness({ config: { automod_anti_links: true, automod_delete_message: true }, throwOnDelete: true });
  const result = await h.runtime.handleMessageEdited(makeMessage({ id: "x1", content: "propre" }), makeMessage({ id: "x1", content: "https://evil.example" }));
  assert.equal(result.matched, true, "la détection a bien lieu");
  assert.equal(result.actions.deleted, false, "la suppression a échoué proprement");
  assert.doesNotThrow(() => {}, "aucune exception propagée");
});

test("7. logs cohérents : un log par sanction, aucun pour ignoré/sans-correspondance", async () => {
  const h = makeHarness({ config: { automod_anti_links: true, automod_delete_message: true } });
  await h.runtime.handleMessageEdited(makeMessage({ id: "l1", content: "propre" }), makeMessage({ id: "l1", content: "toujours propre" }));
  assert.equal(h.moderationLogs.length, 0);
  await h.runtime.handleMessageEdited(makeMessage({ id: "l2", content: "propre" }), makeMessage({ id: "l2", content: "https://evil.example" }));
  assert.equal(h.moderationLogs.length, 1);
  assert.equal(h.moderationLogs[0].rule, "AUTOMOD_LINK");
});

test("détection : une édition (même messageId) ne pousse pas d'entrée spam supplémentaire", () => {
  const { clock } = makeClock();
  const store = new Map();
  const svc = new AutoModDetectionService({ store, clock });
  const cfg = { automod_enabled: true, automod_anti_spam: true };
  svc.detect({ guildId: GUILD, authorId: AUTHOR, content: "un", messageId: "mX", config: cfg, mentionCount: 0 });
  for (let i = 0; i < 10; i++) svc.detect({ guildId: GUILD, authorId: AUTHOR, content: `un edit ${i}`, messageId: "mX", config: cfg, mentionCount: 0 });
  const entries = store.get(`${GUILD}:${AUTHOR}`);
  assert.equal(entries.length, 1, "toutes les éditions du même message = une seule entrée");
  // Legacy sans messageId : chaque appel pousse une entrée.
  const svc2 = new AutoModDetectionService({ store: new Map(), clock });
  svc2.detect({ guildId: GUILD, authorId: AUTHOR, content: "a", config: cfg, mentionCount: 0 });
  svc2.detect({ guildId: GUILD, authorId: AUTHOR, content: "b", config: cfg, mentionCount: 0 });
  assert.equal(svc2.store.get(`${GUILD}:${AUTHOR}`).length, 2, "sans messageId le comportement legacy est conservé");
});

test("câblage messageUpdate : appel AutoMod présent, isolé et non bloquant", async () => {
  const fs = require("node:fs");
  const source = fs.readFileSync("src/events/messageUpdate.js", "utf8");
  assert.match(source, /getAutoModRuntime/);
  assert.match(source, /handleMessageEdited/);
  assert.match(source, /automod_edit_failed/);
  const event = require("../../../events/messageUpdate");
  let threw = false;
  try {
    await event.execute(null, null);
    await event.execute({ content: "a" }, { guild: null, content: "b" });
  } catch { threw = true; }
  assert.equal(threw, false, "l'événement ne doit jamais lever");
});
