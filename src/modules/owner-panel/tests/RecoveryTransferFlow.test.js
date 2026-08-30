"use strict";

// P20.1 — transfert Owner par RÉCUPÉRATION : matrice obligatoire complète.
// Offline intégral : repository en mémoire, env injecté, horloge contrôlée,
// VRAI RecoveryCodeStore pour l'élévation (couplage réel, sans connexion).
// AUCUN secret réel ici : les codes sont des placeholders fictifs de test.

const test = require("node:test");
const assert = require("node:assert/strict");
const { OwnerPanelStateStore } = require("../services/OwnerPanelStateStore");
const { CivratIdentityService } = require("../services/CivratIdentityService");
const { OwnerPanelService } = require("../services/OwnerPanelService");
const { OwnerPanelPolicy, OwnerPanelFieldId: Field, OwnerPanelComponentId: Id } = require("../configuration/ownerPanelConstants");
const routes = require("../interactions/ownerPanelRoutes");
const en = require("../translations/en.json");
const { RecoveryCodeStore } = require("../../recovery/services/RecoveryCodeStore");
const { RecoveryPolicy } = require("../../recovery/configuration/recoveryConstants");

const OWNER_ID = "111111111111111111";
const ADMIN_ID = "222222222222222222";
const RECOVERED_ID = "666666666666666666";
const NEW_OWNER_ID = "777777777777777777";
const SECOND_TARGET_ID = "888888888888888888";
const FAKE_PANEL_CODE = "fake-panel-code-for-tests";
const FAKE_TRANSFER_CODE = "fake-transfer-code-for-tests";

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

// Fixture : couplage RÉEL aux élévations (RecoveryCodeStore partagé) — comme
// getOwnerPanelRuntime le câble en production.
function fixture({ envOwner = OWNER_ID, repoOwner = null, repoAdmins = [], transferCode = FAKE_TRANSFER_CODE, withRepository = true, withElevation = true } = {}) {
  const clock = { now: 1_000_000 };
  const logs = [];
  const logger = { info: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a) };
  const state = new OwnerPanelStateStore();
  const env = { civratOwnerId: () => envOwner, panelMasterCode: () => FAKE_PANEL_CODE, transferCode: () => transferCode };
  const repository = withRepository ? new InMemoryIdentityRepository({ ownerId: repoOwner, adminIds: repoAdmins }) : null;
  const recoveryStore = new RecoveryCodeStore();
  const elevation = withElevation
    ? { isActive: (u) => recoveryStore.hasActiveElevation(u, clock.now), consume: (u) => recoveryStore.clearElevation(u) }
    : null;
  const identity = new CivratIdentityService({ repository, env, logger, elevation });
  const panel = new OwnerPanelService({ state, env, logger, now: () => clock.now });
  const runtime = { identity, panel, state, hasRecoveryElevation: (u) => (elevation ? elevation.isActive(u) : false) };
  const elevate = (userId) => recoveryStore.setElevation(userId, clock.now + RecoveryPolicy.ELEVATION_WINDOW_MS);
  return { runtime, identity, panel, repository, logs, clock, recoveryStore, elevate };
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

// Aide : flux recovery complet jusqu'à l'étape de confirmation.
async function reachRecoveryConfirmation(f, { userId = RECOVERED_ID, targetId = NEW_OWNER_ID, code = FAKE_TRANSFER_CODE } = {}) {
  const { context, sent } = makeContext({
    userId,
    modalValues: { [Field.TRANSFER_CODE]: code, [Field.NEW_OWNER_ID]: targetId },
  });
  await routes.submitRecoveryTransfer(context, f.runtime);
  return sent;
}

// 1. Owner normal : canal Owner inchangé, transfert OK (P20 préservé).
test("owner transfer via the normal channel still works (P20 preserved)", async () => {
  const f = fixture();
  const result = await f.identity.transferOwnership({ actorId: OWNER_ID, newOwnerId: NEW_OWNER_ID });
  assert.equal(result.ok, true);
  assert.equal(await f.identity.getOwnerId(), NEW_OWNER_ID);
});

// 2. Admin normal : JAMAIS de transfert (ni canal Owner, ni canal Recovery).
test("a plain admin can never transfer (both channels refuse)", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  assert.equal((await f.identity.transferOwnership({ actorId: ADMIN_ID, newOwnerId: NEW_OWNER_ID })).code, "OWNER_ONLY");
  assert.equal((await f.identity.transferOwnershipViaRecovery({ actorId: ADMIN_ID, newOwnerId: NEW_OWNER_ID })).code, "RECOVERY_ELEVATION_REQUIRED");
  // Routes : aucune élévation => refus générique immédiat.
  const { context, sent } = makeContext({ userId: ADMIN_ID });
  await routes.openRecoveryTransfer(context, f.runtime);
  assert.equal(sent.replies[0].view.content, en.ownerpanel.refused);
  assert.equal(sent.modals.length, 0);
});

// 3. Recovery « validé » mais élévation absente (jamais élevée) => refus.
test("recovery without any active elevation is refused", async () => {
  const f = fixture();
  const sent = await reachRecoveryConfirmation(f, { userId: RECOVERED_ID });
  assert.equal(sent.replies[0].view.content, en.ownerpanel.refused);
  assert.equal(sent.updates.length, 0);
  assert.equal(f.repository.calls.length, 0);
});

// 4. Élévation EXPIRÉE => refus (au submit comme à la confirmation).
test("an expired recovery elevation is refused at every step", async () => {
  const f = fixture();
  f.elevate(RECOVERED_ID);
  // Le submit passe pendant que l'élévation est active :
  const sent = await reachRecoveryConfirmation(f);
  assert.equal(sent.updates.length, 1, "confirmation step reached while elevated");
  // …puis l'élévation expire avant la confirmation :
  f.clock.now += RecoveryPolicy.ELEVATION_WINDOW_MS + 1;
  assert.equal(f.runtime.hasRecoveryElevation(RECOVERED_ID), false);
  const confirmCtx = makeContext({ userId: RECOVERED_ID });
  await routes.confirmRecoveryAction(confirmCtx.context, f.runtime);
  assert.equal(confirmCtx.sent.replies[0].view.content, en.ownerpanel.refused);
  assert.equal(confirmCtx.sent.updates.length, 0, "no update, no transfer");
  assert.equal(await f.identity.getOwnerId(), OWNER_ID, "owner unchanged");
});

// 5. Recovery élevé + MAUVAIS transfer code => refus générique, aucun pending.
test("elevated user with a wrong transfer code is generically refused", async () => {
  const f = fixture();
  f.elevate(RECOVERED_ID);
  const sent = await reachRecoveryConfirmation(f, { code: "not-the-code" });
  assert.equal(sent.replies[0].view.content, en.ownerpanel.refused);
  assert.equal(f.panel.consumePending(RECOVERED_ID), null);
  assert.equal(f.repository.calls.length, 0);
});

// 6. Recovery élevé + bon code => ÉTAPE DE CONFIRMATION (aucune mutation).
test("elevated user with the right code reaches explicit confirmation", async () => {
  const f = fixture();
  f.elevate(RECOVERED_ID);
  const sent = await reachRecoveryConfirmation(f);
  assert.equal(sent.updates.length, 1);
  assert.ok(sent.updates[0].view.content.includes(NEW_OWNER_ID), "final confirmation names the target");
  assert.deepEqual(
    sent.updates[0].view.components.map((component) => component.customId),
    [Id.RECOVERY_CONFIRM, Id.RECOVERY_CANCEL],
  );
  assert.equal(f.repository.calls.length, 0, "no mutation before confirmation");
});

// 7-10. Recovery + bon code + confirmation => transfert complet et persistant.
test("elevated user + right code + confirmation transfers ownership fully", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID, NEW_OWNER_ID] });
  f.elevate(RECOVERED_ID);
  await reachRecoveryConfirmation(f);
  const confirmCtx = makeContext({ userId: RECOVERED_ID });
  await routes.confirmRecoveryAction(confirmCtx.context, f.runtime);
  assert.equal(confirmCtx.sent.updates[0].view.content, en.ownerpanel.ownerTransferred);
  // 8. l'ancien Owner perd immédiatement son statut (canal Owner refermé) :
  assert.equal(await f.identity.isOwner(OWNER_ID), false);
  assert.equal((await f.identity.transferOwnership({ actorId: OWNER_ID, newOwnerId: SECOND_TARGET_ID })).code, "OWNER_ONLY");
  // 9. le nouveau compte devient Owner :
  assert.equal(await f.identity.isOwner(NEW_OWNER_ID), true);
  // 10. et est retiré des Admins (Owner ≠ Admin) :
  assert.equal(await f.identity.isAdmin(NEW_OWNER_ID), false);
  assert.deepEqual(await f.identity.listAdminIds(), [ADMIN_ID]);
});

// 11. Le transfert persiste après redémarrage : l'env ne restaure PAS l'ancien.
test("the transfer survives a restart: env can never restore the old owner", async () => {
  const f = fixture();
  f.elevate(RECOVERED_ID);
  await f.identity.transferOwnershipViaRecovery({ actorId: RECOVERED_ID, newOwnerId: NEW_OWNER_ID });
  // « Redémarrage » : nouveaux services, MÊME repository, même env.
  const restarted = fixture({ repoOwner: f.repository.ownerId, repoAdmins: f.repository.adminIds });
  assert.equal(await restarted.identity.getOwnerId(), NEW_OWNER_ID, "persisted owner wins over CIVRAT_OWNER_ID");
  assert.equal(await restarted.identity.isOwner(OWNER_ID), false);
  assert.equal(await restarted.identity.isOwner(NEW_OWNER_ID), true);
});

// 12. L'action de confirmation est consommée une seule fois (pas de rejeu).
test("the pending confirmation is consumed exactly once", async () => {
  const f = fixture({ repoAdmins: [] });
  f.elevate(RECOVERED_ID);
  await reachRecoveryConfirmation(f);
  const first = makeContext({ userId: RECOVERED_ID });
  await routes.confirmRecoveryAction(first.context, f.runtime);
  assert.equal(first.sent.updates[0].view.content, en.ownerpanel.ownerTransferred);
  // Rejouer la confirmation : plus de pending (single-use) — et l'élévation
  // a été consommée au succès, donc refus générique applicatif.
  const second = makeContext({ userId: RECOVERED_ID });
  await routes.confirmRecoveryAction(second.context, f.runtime);
  assert.equal(second.sent.replies[0].view.content, en.ownerpanel.refused);
  assert.equal(f.repository.calls.filter(([name]) => name === "transferOwnership").length, 1, "exactly one transfer");
});

// 13. Élévation CONSOMMÉE au succès : aucun second transfert possible.
test("a consumed elevation can never drive a second transfer", async () => {
  const f = fixture();
  f.elevate(RECOVERED_ID);
  const done = await f.identity.transferOwnershipViaRecovery({ actorId: RECOVERED_ID, newOwnerId: NEW_OWNER_ID });
  assert.equal(done.ok, true);
  assert.equal(f.runtime.hasRecoveryElevation(RECOVERED_ID), false, "elevation consumed at success");
  const again = await f.identity.transferOwnershipViaRecovery({ actorId: RECOVERED_ID, newOwnerId: SECOND_TARGET_ID });
  assert.equal(again.code, "RECOVERY_ELEVATION_REQUIRED");
  assert.equal(await f.identity.getOwnerId(), NEW_OWNER_ID);
});

// 14. Aucun secret dans les logs (codes panel + transfer, justes ou faux).
test("no panel/transfer code ever reaches the logs on the recovery channel", async () => {
  const f = fixture();
  f.elevate(RECOVERED_ID);
  await reachRecoveryConfirmation(f, { code: "wrong-transfer-value" });
  await reachRecoveryConfirmation(f);
  const confirmCtx = makeContext({ userId: RECOVERED_ID });
  await routes.confirmRecoveryAction(confirmCtx.context, f.runtime);
  const allLogs = JSON.stringify(f.logs);
  assert.ok(!allLogs.includes(FAKE_PANEL_CODE));
  assert.ok(!allLogs.includes(FAKE_TRANSFER_CODE));
  assert.ok(!allLogs.includes("wrong-transfer-value"));
  assert.ok(allLogs.includes("ownership_transferred_via_recovery"), "generic event logged");
});

// 15. Fail-closed : persistance indisponible => aucun transfert possible.
test("without persistence the recovery transfer fails closed", async () => {
  const f = fixture({ withRepository: false });
  f.elevate(RECOVERED_ID);
  const result = await f.identity.transferOwnershipViaRecovery({ actorId: RECOVERED_ID, newOwnerId: NEW_OWNER_ID });
  assert.equal(result.code, "PERSISTENCE_UNAVAILABLE");
  assert.equal(f.runtime.hasRecoveryElevation(RECOVERED_ID), true, "elevation NOT consumed on failure");
});

// 16. Fail-closed : configuration nécessaire absente.
test("missing transfer code env or unwired elevation fails closed", async () => {
  const noCode = fixture({ transferCode: null });
  noCode.elevate(RECOVERED_ID);
  assert.equal(noCode.panel.verifyTransferCode(RECOVERED_ID, FAKE_TRANSFER_CODE), false);
  const sent = await reachRecoveryConfirmation(noCode);
  assert.equal(sent.replies.length, 1, "generic refusal");
  const noElevation = fixture({ withElevation: false });
  const result = await noElevation.identity.transferOwnershipViaRecovery({ actorId: RECOVERED_ID, newOwnerId: NEW_OWNER_ID });
  assert.equal(result.code, "RECOVERY_ELEVATION_REQUIRED", "unwired elevation => closed");
});

// Ouverture en mode récupération : vue SANS données d'identité + 2 boutons.
test("recovery mode view shows no identity data (opening only)", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  f.elevate(RECOVERED_ID);
  const { context, sent } = makeContext({ userId: RECOVERED_ID });
  await routes.openOwnerPanel(context, f.runtime);
  const view = sent.replies[0].view;
  assert.equal(view.content, en.ownerpanel.recoveryNotice);
  assert.ok(!view.content.includes(OWNER_ID) && !view.content.includes(ADMIN_ID), "no owner/admin ids leaked");
  assert.deepEqual(view.components.map((c) => c.customId), [Id.RECOVERY_TRANSFER]);
  // Membre sans rien : toujours le refus générique (P20 intact).
  const nobody = makeContext({ userId: "999999999999999999" });
  await routes.openOwnerPanel(nobody.context, f.runtime);
  assert.equal(nobody.sent.replies[0].view.content, en.ownerpanel.refused);
});

// Anti force brute PARTAGÉ : 5 mauvais transfer codes => verrou (même seuils).
test("wrong transfer codes feed the shared brute-force lock", async () => {
  const f = fixture();
  f.elevate(RECOVERED_ID);
  for (let i = 0; i < OwnerPanelPolicy.MAX_MASTER_FAILURES; i += 1) {
    f.panel.verifyTransferCode(RECOVERED_ID, `wrong-${i}`);
  }
  assert.equal(f.panel.verifyTransferCode(RECOVERED_ID, FAKE_TRANSFER_CODE), false, "locked even with the right code");
  // Le verrou bloque AUSSI le Master Code (compteur partagé documenté) :
  assert.equal(f.panel.tryAuthenticate(RECOVERED_ID, FAKE_PANEL_CODE).code, "PANEL_LOCKED");
  f.clock.now += OwnerPanelPolicy.LOCK_TTL_MS + 1;
  assert.equal(f.panel.verifyTransferCode(RECOVERED_ID, FAKE_TRANSFER_CODE), true, "lock expires");
});
