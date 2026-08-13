"use strict";

// P20 — Owner Panel CIVRAT : couverture offline complète. Aucune connexion
// Discord/Supabase : repository en mémoire, env injecté, horloge contrôlée.
// AUCUN secret réel ici : les « codes » sont des placeholders fictifs de test,
// posés dans la fixture — jamais lus depuis un quelconque environnement.

const test = require("node:test");
const assert = require("node:assert/strict");
const { OwnerPanelStateStore } = require("../services/OwnerPanelStateStore");
const { CivratIdentityService } = require("../services/CivratIdentityService");
const { OwnerPanelService } = require("../services/OwnerPanelService");
const { CivratIdentityOwnerProvider } = require("../services/CivratIdentityOwnerProvider");
const { OwnerPanelPolicy, OwnerPanelFieldId: Field, OwnerPanelComponentId: Id } = require("../configuration/ownerPanelConstants");
const routes = require("../interactions/ownerPanelRoutes");
const fr = require("../translations/fr.json");
const en = require("../translations/en.json");
const { RecoveryService } = require("../../recovery/services/RecoveryService");
const { RecoveryCodeStore } = require("../../recovery/services/RecoveryCodeStore");

const OWNER_ID = "111111111111111111";
const ADMIN_ID = "222222222222222222";
const MEMBER_ID = "333333333333333333";
const TARGET_ID = "444444444444444444";
const NEW_OWNER_ID = "555555555555555555";
const FAKE_PANEL_CODE = "fake-panel-code-for-tests";
const FAKE_TRANSFER_CODE = "fake-transfer-code-for-tests";

// Repository en mémoire : imite SupabaseCivratIdentityRepository (aucune
// écriture extérieure) et trace les mutations pour les assertions.
class InMemoryIdentityRepository {
  constructor({ ownerId = null, adminIds = [] } = {}) {
    this.ownerId = ownerId;
    this.adminIds = [...adminIds];
    this.calls = [];
  }
  async readOwnerId() { return this.ownerId; }
  async writeOwnerId(id) { this.calls.push(["writeOwnerId", id]); this.ownerId = id; }
  async readAdminIds() { return [...this.adminIds]; }
  async addAdmin(id) { this.calls.push(["addAdmin", id]); if (!this.adminIds.includes(id)) this.adminIds.push(id); }
  async removeAdmin(id) { this.calls.push(["removeAdmin", id]); this.adminIds = this.adminIds.filter((a) => a !== id); }
  async transferOwnership({ newOwnerId }) { this.calls.push(["transferOwnership", newOwnerId]); this.ownerId = newOwnerId; this.adminIds = this.adminIds.filter((a) => a !== newOwnerId); }
}

function fixture({ envOwner = OWNER_ID, repoOwner = null, repoAdmins = [], panelCode = FAKE_PANEL_CODE, transferCode = FAKE_TRANSFER_CODE, withRepository = true } = {}) {
  const clock = { now: 1_000_000 };
  const logs = [];
  const logger = { info: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a) };
  const state = new OwnerPanelStateStore();
  const env = { civratOwnerId: () => envOwner, panelMasterCode: () => panelCode, transferCode: () => transferCode };
  const repository = withRepository ? new InMemoryIdentityRepository({ ownerId: repoOwner, adminIds: repoAdmins }) : null;
  const identity = new CivratIdentityService({ repository, env, logger });
  const panel = new OwnerPanelService({ state, env, logger, now: () => clock.now });
  const elevated = new Set();
  const runtime = { identity, panel, state, hasRecoveryElevation: (userId) => elevated.has(userId) };
  return { runtime, identity, panel, repository, logs, clock, elevated, logger };
}

function makeContext({ userId, modalValues = {}, dict = en }) {
  const sent = { replies: [], updates: [], modals: [] };
  const t = (key, vars) => {
    const raw = key.split(".").reduce((v, s) => (v ? v[s] : undefined), dict);
    return typeof raw === "string" ? raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, n) => String(vars?.[n] ?? "")) : raw;
  };
  const context = {
    userId,
    guildId: "g1",
    t,
    envelope: {
      modalValues,
      transport: {
        reply: async (payload) => { sent.replies.push(payload); },
        update: async (payload) => { sent.updates.push(payload); },
        showModal: async (modal) => { sent.modals.push(modal); },
      },
    },
  };
  return { context, sent };
}

// 1. Owner initial : env quand la persistance est vide ; distinction stricte.
test("initial owner comes from env when persistence is empty; owner != admin", async () => {
  const f = fixture();
  assert.equal(await f.identity.getOwnerId(), OWNER_ID);
  assert.equal(await f.identity.isOwner(OWNER_ID), true);
  assert.equal(await f.identity.isOwner(ADMIN_ID), false);
  assert.equal(await f.identity.isAdmin(OWNER_ID), false, "Owner is not an admin");
  assert.equal(await f.identity.isAdmin(ADMIN_ID), false);
  // La persistance prime une fois un transfert effectué :
  const stored = fixture({ repoOwner: TARGET_ID });
  assert.equal(await stored.identity.getOwnerId(), TARGET_ID, "persisted owner wins over env");
});

// 2. Simple membre : ne peut pas ouvrir, réponse générique, aucune modale.
test("a plain member cannot open the panel (generic ephemeral refusal)", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  const { context, sent } = makeContext({ userId: MEMBER_ID });
  assert.equal(await routes.canOpen(context, f.runtime), false);
  await routes.openOwnerPanel(context, f.runtime);
  assert.equal(sent.modals.length, 0);
  assert.equal(sent.replies.length, 1);
  assert.equal(sent.replies[0].ephemeral, true);
  assert.equal(sent.replies[0].view.content, en.ownerpanel.refused);
});

// 3. Admin sans code : aucune session, aucune donnée.
test("an admin without code has no session (no panel content)", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  assert.equal(await routes.canOpen({ userId: ADMIN_ID }, f.runtime), true, "admin may open");
  assert.equal(f.panel.authenticate(ADMIN_ID), false, "no session without code");
  // Une route d'action exige la session même pour un Owner :
  const ownerCtx = makeContext({ userId: OWNER_ID });
  await routes.openAddAdmin(ownerCtx.context, f.runtime);
  assert.equal(ownerCtx.sent.modals.length, 0);
  assert.equal(ownerCtx.sent.replies[0].view.content, en.ownerpanel.refused);
});

// 4. Admin avec mauvais code : refus générique (route = même vue que tout refus).
test("an admin with a wrong master code gets the generic refusal only", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  const result = f.panel.tryAuthenticate(ADMIN_ID, "totally-wrong");
  assert.equal(result.ok, false);
  assert.equal(result.code, "PANEL_AUTH_REFUSED");
  const { context, sent } = makeContext({ userId: ADMIN_ID, modalValues: { [Field.MASTER]: "totally-wrong" } });
  await routes.submitMasterCode(context, f.runtime);
  assert.equal(sent.replies[0].view.content, en.ownerpanel.refused, "no hint about correctness");
});

// 5. Admin avec bon code : session + lecture seule (aucun bouton d'action).
test("an admin with the right code gets a read-only session", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  assert.equal(f.panel.tryAuthenticate(ADMIN_ID, FAKE_PANEL_CODE).ok, true);
  const { context, sent } = makeContext({ userId: ADMIN_ID, modalValues: { [Field.MASTER]: FAKE_PANEL_CODE } });
  await routes.submitMasterCode(context, f.runtime);
  const view = sent.replies[0].view;
  assert.deepEqual(view.components, [], "no owner action buttons for an admin");
  assert.ok(view.content.includes(OWNER_ID), "read shows the current owner");
  assert.ok(view.content.includes(ADMIN_ID), "read shows the admin list");
});

// 6. Owner avec bon code : session + boutons d'action.
test("the owner with the right code sees the action buttons", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  const { context, sent } = makeContext({ userId: OWNER_ID, modalValues: { [Field.MASTER]: FAKE_PANEL_CODE } });
  await routes.submitMasterCode(context, f.runtime);
  const ids = sent.replies[0].view.components.map((c) => c.customId);
  assert.deepEqual(ids, [Id.ADD_ADMIN, Id.REMOVE_ADMIN, Id.TRANSFER]);
  assert.ok(sent.replies[0].view.content.includes(en.ownerpanel.youAreOwner.slice(0, 20)));
});

// 7. Ajout d'un admin (avec confirmation explicite via les routes).
test("adding an admin only happens after explicit confirmation", async () => {
  const f = fixture();
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE);
  const { context, sent } = makeContext({ userId: OWNER_ID, modalValues: { [Field.TARGET_ID]: TARGET_ID } });
  await routes.submitAddAdmin(context, f.runtime);
  assert.equal(sent.updates[0].view.content, en.ownerpanel.confirmAddAdmin.replace("{{target}}", `<@${TARGET_ID}> (\`${TARGET_ID}\`)`));
  assert.equal(f.repository.calls.length, 0, "no mutation before confirmation");
  // Confirmation => mutation.
  const confirmCtx = makeContext({ userId: OWNER_ID });
  await routes.confirmAction(confirmCtx.context, f.runtime);
  assert.equal(confirmCtx.sent.updates[0].view.content, en.ownerpanel.adminAdded);
  assert.deepEqual(await f.identity.listAdminIds(), [TARGET_ID]);
});

// 8. Suppression d'un admin (avec confirmation).
test("removing an admin only happens after explicit confirmation", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE);
  const { context } = makeContext({ userId: OWNER_ID, modalValues: { [Field.TARGET_ID]: ADMIN_ID } });
  await routes.submitRemoveAdmin(context, f.runtime);
  assert.equal(f.repository.calls.length, 0, "no mutation before confirmation");
  const confirmCtx = makeContext({ userId: OWNER_ID });
  await routes.confirmAction(confirmCtx.context, f.runtime);
  assert.equal(confirmCtx.sent.updates[0].view.content, en.ownerpanel.adminRemoved);
  assert.deepEqual(await f.identity.listAdminIds(), []);
  assert.equal(await f.identity.isAdmin(ADMIN_ID), false);
});

// 9-11. Transfert Owner complet : code + ID + confirmation finale.
test("full ownership transfer: code + new id + final confirmation", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID, NEW_OWNER_ID] });
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE);
  const { context, sent } = makeContext({
    userId: OWNER_ID,
    modalValues: { [Field.TRANSFER_CODE]: FAKE_TRANSFER_CODE, [Field.NEW_OWNER_ID]: NEW_OWNER_ID },
  });
  await routes.submitTransfer(context, f.runtime);
  assert.ok(sent.updates[0].view.content.includes(NEW_OWNER_ID), "final confirmation names the target");
  assert.equal(f.repository.calls.length, 0, "no transfer before final confirmation");
  const confirmCtx = makeContext({ userId: OWNER_ID });
  await routes.confirmAction(confirmCtx.context, f.runtime);
  assert.equal(confirmCtx.sent.updates[0].view.content, en.ownerpanel.ownerTransferred);
  // 9. transfert persisté (prime sur l'env)
  assert.equal(await f.identity.getOwnerId(), NEW_OWNER_ID);
  // 10. l'ancien Owner perd immédiatement son statut
  assert.equal(await f.identity.isOwner(OWNER_ID), false);
  // 11. le nouveau devient l'unique Owner et n'est plus listé admin
  assert.equal(await f.identity.isOwner(NEW_OWNER_ID), true);
  assert.equal(await f.identity.isAdmin(NEW_OWNER_ID), false);
  assert.deepEqual(await f.identity.listAdminIds(), [ADMIN_ID]);
});

// 12. Jamais un admin ne peut transférer (double barrière : route + service).
test("an admin can never transfer ownership (service + provider barriers)", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  // Barrière service :
  const result = await f.identity.transferOwnership({ actorId: ADMIN_ID, newOwnerId: TARGET_ID });
  assert.equal(result.ok, false);
  assert.equal(result.code, "OWNER_ONLY");
  // Barrière route (PermissionService lit le provider) :
  const provider = new CivratIdentityOwnerProvider({ identityServiceFactory: () => f.identity });
  assert.equal(await provider.isOwner(ADMIN_ID), false);
  assert.equal(await provider.isOwner(OWNER_ID), true);
  assert.equal(await f.identity.getOwnerId(), OWNER_ID, "still the original owner");
});

// 13. Mauvais OWNER_TRANSFER_CODE : refus générique, aucune action en attente.
test("a wrong transfer code is generically refused (no pending action)", async () => {
  const f = fixture();
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE);
  const { context, sent } = makeContext({
    userId: OWNER_ID,
    modalValues: { [Field.TRANSFER_CODE]: "not-the-transfer-code", [Field.NEW_OWNER_ID]: NEW_OWNER_ID },
  });
  await routes.submitTransfer(context, f.runtime);
  assert.equal(sent.replies[0].view.content, en.ownerpanel.refused);
  assert.equal(sent.updates.length, 0);
  assert.equal(f.panel.consumePending(OWNER_ID), null, "nothing left to confirm");
  assert.equal(await f.identity.getOwnerId(), OWNER_ID);
});

// 14. Confirmation obligatoire : annulation => aucune mutation ; rejouer => expiré.
test("cancel consumes the pending action: no mutation, no replay", async () => {
  const f = fixture();
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE);
  const { context } = makeContext({ userId: OWNER_ID, modalValues: { [Field.TARGET_ID]: TARGET_ID } });
  await routes.submitAddAdmin(context, f.runtime);
  const cancelCtx = makeContext({ userId: OWNER_ID });
  await routes.cancelAction(cancelCtx.context, f.runtime);
  assert.equal(cancelCtx.sent.updates[0].view.content, en.ownerpanel.cancelled);
  assert.equal(f.repository.calls.length, 0, "cancelled action never mutates");
  const confirmCtx = makeContext({ userId: OWNER_ID });
  await routes.confirmAction(confirmCtx.context, f.runtime);
  assert.equal(confirmCtx.sent.updates[0].view.content, en.ownerpanel.actionExpired, "consumed actions cannot be replayed");
  assert.deepEqual(await f.identity.listAdminIds(), []);
});

// 15. Aucun secret (codes panel/transfert) n'apparaît jamais dans les logs.
test("master/transfer codes never reach the logs", async () => {
  const f = fixture();
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE);
  f.panel.tryAuthenticate(ADMIN_ID, "some-wrong-code");
  f.panel.verifyTransferCode(OWNER_ID, FAKE_TRANSFER_CODE);
  f.panel.verifyTransferCode(OWNER_ID, "wrong-transfer-code");
  const allLogs = JSON.stringify(f.logs);
  assert.ok(!allLogs.includes(FAKE_PANEL_CODE), "panel master code never logged");
  assert.ok(!allLogs.includes(FAKE_TRANSFER_CODE), "transfer code never logged");
  assert.ok(!allLogs.includes("some-wrong-code"), "even wrong attempts are never logged");
  assert.ok(allLogs.includes("owner_panel_authenticated"), "generic events are logged");
});

// 16/17. Recovery toujours fonctionnel + élévation Recovery ouvre le panel.
test("recovery stays functional and an active recovery elevation can open the panel", async () => {
  // Recovery inchangé : double facteur complet, élévation dans le STORE partagé.
  const store = new RecoveryCodeStore();
  const sent = [];
  const recovery = new RecoveryService({
    store,
    env: { masterCode: () => "fake-recovery-master", recoveryEmail: () => "owner@example.test" },
    mailer: { send: async ({ text }) => { sent.push(text); } },
  });
  const request = await recovery.requestRecovery({ guildId: "g1", userId: MEMBER_ID, masterCode: "fake-recovery-master" });
  assert.equal(request.code, "RECOVERY_CODE_SENT");
  const tempCode = sent[0].match(/\b(\d{6})\b/)[1];
  assert.equal(recovery.verifyRecovery({ guildId: "g1", userId: MEMBER_ID, code: tempCode }).recovered, true);
  assert.equal(store.hasActiveElevation(MEMBER_ID, Date.now()), true, "elevation lives in the shared store");
  // L'élévation donne l'OUVERTURE du panel — P20.1 : vue de récupération
  // (aucune donnée d'identité), la modale Master Code reste accessible via
  // le bouton dédié (accès lecture préservé, inchangé).
  const f = fixture();
  f.elevated.add(MEMBER_ID);
  const { context, sent: sent2 } = makeContext({ userId: MEMBER_ID });
  assert.equal(await routes.canOpen(context, f.runtime), true);
  await routes.openOwnerPanel(context, f.runtime);
  assert.equal(sent2.replies.length, 1, "P20.1: recovery elevation opens the recovery view");
  assert.equal(sent2.replies[0].view.content, en.ownerpanel.recoveryNotice);
  await routes.openRecoveryMaster(context, f.runtime);
  assert.equal(sent2.modals.length, 1, "master-code modal still reachable (read-only P20 path preserved)");
  // Toujours NON-Owner :
  assert.equal(await f.identity.isOwner(MEMBER_ID), false, "recovery never promotes to owner");
});

// Élévation expirée => ouverture refermée (fail-closed).
test("an expired recovery elevation can no longer open the panel", async () => {
  const f = fixture();
  f.elevated.add(MEMBER_ID);
  assert.equal(await routes.canOpen({ userId: MEMBER_ID }, f.runtime), true);
  f.elevated.delete(MEMBER_ID); // expiration = élévation retirée du store
  assert.equal(await routes.canOpen({ userId: MEMBER_ID }, f.runtime), false);
});

// 18. Fail-closed : variables absentes / persistance absente.
test("missing env or persistence fails closed everywhere", async () => {
  const noCodes = fixture({ panelCode: null, transferCode: null });
  assert.equal(noCodes.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE).code, "PANEL_UNAVAILABLE");
  assert.equal(noCodes.panel.verifyTransferCode(OWNER_ID, FAKE_TRANSFER_CODE), false);
  const noRepo = fixture({ withRepository: false, envOwner: null });
  assert.equal(await noRepo.identity.getOwnerId(), null);
  assert.equal(await noRepo.identity.isOwner(OWNER_ID), false);
  assert.deepEqual(await noRepo.identity.listAdminIds(), []);
  assert.equal((await noRepo.identity.addAdmin({ actorId: OWNER_ID, targetId: TARGET_ID })).code, "OWNER_ONLY", "no owner => no mutation");
  const envOnly = fixture({ withRepository: false });
  assert.equal((await envOnly.identity.addAdmin({ actorId: OWNER_ID, targetId: TARGET_ID })).code, "PERSISTENCE_UNAVAILABLE");
  assert.equal((await envOnly.identity.transferOwnership({ actorId: OWNER_ID, newOwnerId: NEW_OWNER_ID })).code, "PERSISTENCE_UNAVAILABLE");
});

// Anti force brute : 5 échecs => verrouillage, même le bon code est refusé.
test("5 wrong master attempts lock the panel temporarily (then recover)", () => {
  const f = fixture();
  for (let i = 0; i < OwnerPanelPolicy.MAX_MASTER_FAILURES; i += 1) {
    f.panel.tryAuthenticate(OWNER_ID, `wrong-${i}`);
  }
  assert.equal(f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE).code, "PANEL_LOCKED", "even the right code is refused while locked");
  f.clock.now += OwnerPanelPolicy.LOCK_TTL_MS + 1;
  assert.equal(f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE).ok, true, "lock expires");
});

// Sessions et confirmations expirent (fail-closed).
test("sessions and pending confirmations expire (fail-closed)", async () => {
  const f = fixture();
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE);
  f.clock.now += OwnerPanelPolicy.SESSION_TTL_MS + 1;
  assert.equal(f.panel.authenticate(OWNER_ID), false, "session expired");
  // Nouvelle session, action en attente, puis expiration de la confirmation :
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE);
  f.panel.setPending(OWNER_ID, { type: "ADD_ADMIN", targetId: TARGET_ID });
  f.clock.now += OwnerPanelPolicy.PENDING_TTL_MS + 1;
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE); // session à nouveau valide
  const { context, sent } = makeContext({ userId: OWNER_ID });
  await routes.confirmAction(context, f.runtime);
  assert.equal(sent.updates[0].view.content, en.ownerpanel.actionExpired);
  assert.equal(f.repository.calls.length, 0);
});

// Validations métier : cibles invalides refusées sans mutation.
test("invalid targets are refused without mutation", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  assert.equal((await f.identity.addAdmin({ actorId: OWNER_ID, targetId: "not-an-id" })).code, "INVALID_TARGET_ID");
  assert.equal((await f.identity.addAdmin({ actorId: OWNER_ID, targetId: TARGET_ID, })).ok, true);
  assert.equal((await f.identity.addAdmin({ actorId: OWNER_ID, targetId: TARGET_ID })).code, "TARGET_ALREADY_ADMIN");
  assert.equal((await f.identity.addAdmin({ actorId: OWNER_ID, targetId: OWNER_ID })).code, "TARGET_IS_OWNER");
  assert.equal((await f.identity.removeAdmin({ actorId: OWNER_ID, targetId: TARGET_ID + "9" })).code, "TARGET_NOT_ADMIN");
  assert.equal((await f.identity.transferOwnership({ actorId: OWNER_ID, newOwnerId: OWNER_ID })).code, "TARGET_ALREADY_OWNER");
});

// Provider fail-closed : toute erreur interne => false (jamais de fuite).
test("the civrat owner provider fails closed on any internal error", async () => {
  const broken = new CivratIdentityOwnerProvider({ identityServiceFactory: () => ({ isOwner: async () => { throw new Error("db down"); } }) });
  assert.equal(await broken.isOwner(OWNER_ID), false);
  assert.equal(await broken.isOwner(null), false);
});

// Anti-rejeu : la soumission du Master Code revérifie l'ouverture.
test("master submit re-checks open rights (no replay by outsiders)", async () => {
  const f = fixture();
  const { context, sent } = makeContext({ userId: MEMBER_ID, modalValues: { [Field.MASTER]: FAKE_PANEL_CODE } });
  await routes.submitMasterCode(context, f.runtime);
  assert.equal(sent.replies[0].view.content, en.ownerpanel.refused, "even the right code is useless without open rights");
  assert.equal(f.panel.authenticate(MEMBER_ID), false, "no session granted");
});

// Les 3 variables du .env.example suivi restent des placeholders vides.
test(".env.example owner panel variables stay empty placeholders", () => {
  const fs = require("node:fs");
  const env = fs.readFileSync(".env.example", "utf8");
  for (const name of ["CIVRAT_OWNER_ID", "OWNER_PANEL_MASTER_CODE", "OWNER_TRANSFER_CODE"]) {
    assert.match(env, new RegExp(`^${name}=\\s*$`, "m"), `${name} must stay empty`);
  }
});
