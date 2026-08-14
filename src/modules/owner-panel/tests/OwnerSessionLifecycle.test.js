"use strict";

// V1 — cycle de vie des sessions Owner (24 h) et accès permanent Admin.
// Offline intégral : repository en mémoire, env injecté, horloge contrôlée.
// AUCUN secret réel : les « codes » sont des placeholders fictifs de test.

const test = require("node:test");
const assert = require("node:assert/strict");
const { OwnerPanelStateStore } = require("../services/OwnerPanelStateStore");
const { CivratIdentityService } = require("../services/CivratIdentityService");
const { OwnerPanelService } = require("../services/OwnerPanelService");
const { CivratIdentityOwnerProvider } = require("../services/CivratIdentityOwnerProvider");
const { OwnerPanelPolicy, OwnerPanelComponentId: Id } = require("../configuration/ownerPanelConstants");
const routes = require("../interactions/ownerPanelRoutes");
const { RecoveryCodeStore } = require("../../recovery/services/RecoveryCodeStore");
const { RecoveryPolicy } = require("../../recovery/configuration/recoveryConstants");
const en = require("../translations/en.json");

const OWNER_ID = "111111111111111111";
const ADMIN_ID = "222222222222222222";
const RECOVERED_ID = "666666666666666666";
const NEW_OWNER_ID = "555555555555555555";
const FAKE_PANEL_CODE = "fake-panel-code-for-tests";
const FAKE_TRANSFER_CODE = "fake-transfer-code-for-tests";

class InMemoryIdentityRepository {
  constructor({ ownerId = null, adminIds = [] } = {}) {
    this.ownerId = ownerId;
    this.adminIds = [...adminIds];
  }
  async readOwnerId() { return this.ownerId; }
  async readAdminIds() { return [...this.adminIds]; }
  async addAdmin(id) { if (!this.adminIds.includes(id)) this.adminIds.push(id); }
  async removeAdmin(id) { this.adminIds = this.adminIds.filter((a) => a !== id); }
  async transferOwnership({ newOwnerId }) { this.ownerId = newOwnerId; this.adminIds = this.adminIds.filter((a) => a !== newOwnerId); }
}

// Fixture identique à la production : onOwnershipTransferred → state.revokeSession.
function fixture({ envOwner = OWNER_ID, repoAdmins = [], withRepository = true } = {}) {
  const clock = { now: 1_000_000_000 };
  const logs = [];
  const logger = { info: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a) };
  const state = new OwnerPanelStateStore();
  const env = { civratOwnerId: () => envOwner, panelMasterCode: () => FAKE_PANEL_CODE, transferCode: () => FAKE_TRANSFER_CODE };
  const repository = withRepository ? new InMemoryIdentityRepository({ ownerId: null, adminIds: repoAdmins }) : null;
  const recoveryStore = new RecoveryCodeStore();
  const elevation = {
    isActive: (u) => recoveryStore.hasActiveElevation(u, clock.now),
    consume: (u) => recoveryStore.clearElevation(u),
  };
  const identity = new CivratIdentityService({
    repository, env, logger, elevation,
    onOwnershipTransferred: (previousOwnerId) => state.revokeSession(previousOwnerId),
  });
  const panel = new OwnerPanelService({ state, env, logger, now: () => clock.now });
  const runtime = { identity, panel, state, hasRecoveryElevation: (u) => elevation.isActive(u) };
  return { runtime, identity, panel, state, repository, env, logs, clock, recoveryStore };
}

function makeContext({ userId, modalValues = {} } = {}) {
  const sent = { replies: [], updates: [], modals: [] };
  const t = (key, vars) => {
    const raw = key.split(".").reduce((v, s) => (v ? v[s] : undefined), en);
    return typeof raw === "string" ? raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, n) => String(vars?.[n] ?? "")) : raw;
  };
  const context = {
    userId,
    guildId: "g1",
    t,
    envelope: {
      modalValues,
      transport: {
        reply: async (p) => { sent.replies.push(p); },
        update: async (p) => { sent.updates.push(p); },
        showModal: async (m) => { sent.modals.push(m); },
      },
    },
  };
  return { context, sent };
}

// 1. Owner authentifié → session 24 h.
test("owner authentication creates a 24h session", () => {
  const f = fixture();
  const result = f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true });
  assert.equal(result.ok, true);
  assert.equal(f.state.hasActiveSession(OWNER_ID, f.clock.now + OwnerPanelPolicy.OWNER_SESSION_TTL_MS - 1), true, "active before 24h");
  assert.equal(f.state.hasActiveSession(OWNER_ID, f.clock.now + OwnerPanelPolicy.OWNER_SESSION_TTL_MS + 1), false, "expired after 24h");
});

// 2. Owner actif avant expiration → accès autorisé.
test("owner with an active session can use sensitive functions", async () => {
  const f = fixture();
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true });
  const { context, sent } = makeContext({ userId: OWNER_ID });
  await routes.openAddAdmin(context, f.runtime);
  assert.equal(sent.modals.length, 1, "action modal opened while session is active");
});

// 3+4. Après 24 h → session expirée et accès sensible refusé.
test("after 24h the owner session expires and sensitive access is refused", async () => {
  const f = fixture();
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true });
  f.clock.now += OwnerPanelPolicy.OWNER_SESSION_TTL_MS + 1;
  assert.equal(f.panel.authenticate(OWNER_ID), false, "session expired");
  const { context, sent } = makeContext({ userId: OWNER_ID });
  await routes.openAddAdmin(context, f.runtime);
  assert.equal(sent.modals.length, 0, "no action modal after expiry");
  assert.equal(sent.replies[0].view.content, en.ownerpanel.refused);
});

// 5. Ré-authentification → nouvelle session 24 h.
test("owner re-authenticates with the master code for a fresh 24h session", async () => {
  const f = fixture();
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true });
  f.clock.now += OwnerPanelPolicy.OWNER_SESSION_TTL_MS + 1;
  assert.equal(f.panel.authenticate(OWNER_ID), false);
  const result = f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true });
  assert.equal(result.ok, true);
  assert.equal(f.state.hasActiveSession(OWNER_ID, f.clock.now + OwnerPanelPolicy.OWNER_SESSION_TTL_MS - 1), true);
});

// 6+7. L'expiration ne supprime jamais le statut Owner ni CIVRAT_OWNER_ID.
test("session expiry never removes owner status nor CIVRAT_OWNER_ID", async () => {
  const f = fixture();
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true });
  f.clock.now += OwnerPanelPolicy.OWNER_SESSION_TTL_MS + 1;
  assert.equal(f.panel.authenticate(OWNER_ID), false, "session expired");
  assert.equal(await f.identity.isOwner(OWNER_ID), true, "owner status untouched");
  assert.equal(await f.identity.getOwnerId(), OWNER_ID, "persistent identity unchanged");
  assert.equal(f.env.civratOwnerId(), OWNER_ID, "CIVRAT_OWNER_ID unchanged");
});

// 8+9. Admin CIVRAT → accès permanent, sans code, sans session, sans expiration.
test("admin has permanent code-free access (no session, no expiry)", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  const { context, sent } = makeContext({ userId: ADMIN_ID });
  await routes.openOwnerPanel(context, f.runtime);
  assert.equal(sent.modals.length, 0, "no master modal for an admin");
  assert.equal(sent.replies.length, 1, "direct read-only panel");
  assert.deepEqual(sent.replies[0].view.components, [], "no action buttons for an admin");
  assert.equal(f.panel.authenticate(ADMIN_ID), false, "admin holds no session at all");
  // Simuler plusieurs jours → l'accès reste ouvert (statut persistant).
  f.clock.now += 100 * 24 * 60 * 60 * 1000;
  const later = makeContext({ userId: ADMIN_ID });
  await routes.openOwnerPanel(later.context, f.runtime);
  assert.equal(later.sent.modals.length, 0);
  assert.equal(later.sent.replies.length, 1, "still authorized after days");
});

// 10. Admin retiré de la liste → accès immédiatement refusé.
test("removing an admin immediately refuses access (no stale bypass)", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  const before = makeContext({ userId: ADMIN_ID });
  await routes.openOwnerPanel(before.context, f.runtime);
  assert.equal(before.sent.replies.length, 1, "access while listed");
  await f.identity.removeAdmin({ actorId: OWNER_ID, targetId: ADMIN_ID });
  const after = makeContext({ userId: ADMIN_ID });
  await routes.openOwnerPanel(after.context, f.runtime);
  assert.equal(after.sent.replies[0].view.content, en.ownerpanel.refused, "access revoked");
});

// 11. Admin ne peut jamais ajouter/supprimer un Admin.
test("an admin can never add or remove an admin", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  assert.equal((await f.identity.addAdmin({ actorId: ADMIN_ID, targetId: NEW_OWNER_ID })).code, "OWNER_ONLY");
  assert.equal((await f.identity.removeAdmin({ actorId: ADMIN_ID, targetId: ADMIN_ID })).code, "OWNER_ONLY");
  assert.equal(await f.identity.isAdmin(NEW_OWNER_ID), false);
});

// 12. Admin ne peut jamais transférer l'Owner (canal normal ET Recovery).
test("an admin can never transfer ownership (normal or recovery channel)", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  assert.equal((await f.identity.transferOwnership({ actorId: ADMIN_ID, newOwnerId: NEW_OWNER_ID })).code, "OWNER_ONLY");
  assert.equal((await f.identity.transferOwnershipViaRecovery({ actorId: ADMIN_ID, newOwnerId: NEW_OWNER_ID })).code, "RECOVERY_ELEVATION_REQUIRED");
  assert.equal(await f.identity.getOwnerId(), OWNER_ID, "owner unchanged");
});

// 13. Admin ne satisfait jamais CIVRAT_OWNER (barrière router conservée).
test("the CIVRAT_OWNER router barrier rejects an admin on every action route", async () => {
  const f = fixture({ repoAdmins: [ADMIN_ID] });
  const provider = new CivratIdentityOwnerProvider({ identityServiceFactory: () => f.identity });
  assert.equal(await provider.isOwner(ADMIN_ID), false, "admin is never CIVRAT_OWNER");
  assert.equal(await provider.isOwner(OWNER_ID), true);
  const { InteractionRegistry } = require("../../../core/interactions");
  const { PermissionName } = require("../../../core/permissions");
  const { registerOwnerPanel } = require("../register");
  const registry = new InteractionRegistry();
  registerOwnerPanel({ registry, runtimeFactory: () => f.runtime });
  for (const customId of [Id.ADD_ADMIN, Id.REMOVE_ADMIN, Id.TRANSFER]) {
    const route = registry.find({ kind: "button", customId });
    assert.deepEqual(route.permissions.allOf, [PermissionName.CIVRAT_OWNER], `${customId} stays owner-only`);
  }
});

// 14+15. Transfert réussi → session de l'ancien Owner révoquée (normal + Recovery).
test("a successful normal transfer revokes the old owner's session immediately", async () => {
  const f = fixture({ repoAdmins: [NEW_OWNER_ID] });
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true });
  assert.equal(f.panel.authenticate(OWNER_ID), true, "owner has an active session");
  const result = await f.identity.transferOwnership({ actorId: OWNER_ID, newOwnerId: NEW_OWNER_ID });
  assert.equal(result.ok, true);
  assert.equal(f.panel.authenticate(OWNER_ID), false, "old owner session revoked");
  assert.equal(await f.identity.isOwner(OWNER_ID), false);
  assert.equal(await f.identity.isOwner(NEW_OWNER_ID), true);
});

test("a successful recovery transfer revokes the old owner's session too", async () => {
  const f = fixture();
  f.recoveryStore.setElevation(RECOVERED_ID, f.clock.now + RecoveryPolicy.ELEVATION_WINDOW_MS);
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true });
  assert.equal(f.panel.authenticate(OWNER_ID), true);
  const result = await f.identity.transferOwnershipViaRecovery({ actorId: RECOVERED_ID, newOwnerId: NEW_OWNER_ID });
  assert.equal(result.ok, true);
  assert.equal(f.panel.authenticate(OWNER_ID), false, "old owner session revoked via recovery");
  assert.equal(await f.identity.isOwner(NEW_OWNER_ID), true);
});

// 16+17. Nouveau Owner → aucune session automatique ; il s'authentifie.
test("the new owner gets no automatic session and must authenticate for 24h", async () => {
  const f = fixture();
  await f.identity.transferOwnership({ actorId: OWNER_ID, newOwnerId: NEW_OWNER_ID });
  assert.equal(f.panel.authenticate(NEW_OWNER_ID), false, "no automatic session");
  const result = f.panel.tryAuthenticate(NEW_OWNER_ID, FAKE_PANEL_CODE, { isOwner: true });
  assert.equal(result.ok, true);
  assert.equal(f.state.hasActiveSession(NEW_OWNER_ID, f.clock.now + OwnerPanelPolicy.OWNER_SESSION_TTL_MS - 1), true);
});

// 18. Anti-brute-force toujours fonctionnel.
test("anti brute-force still locks after repeated failures then recovers", () => {
  const f = fixture();
  for (let i = 0; i < OwnerPanelPolicy.MAX_MASTER_FAILURES; i += 1) {
    f.panel.tryAuthenticate(OWNER_ID, `wrong-${i}`, { isOwner: true });
  }
  assert.equal(f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true }).code, "PANEL_LOCKED", "locked even with the right code");
  f.clock.now += OwnerPanelPolicy.LOCK_TTL_MS + 1;
  assert.equal(f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true }).ok, true, "lock expires");
});

// 19. Les codes ne sont jamais présents dans les logs.
test("no master/transfer code ever reaches the logs", () => {
  const f = fixture();
  f.panel.tryAuthenticate(OWNER_ID, FAKE_PANEL_CODE, { isOwner: true });
  f.panel.tryAuthenticate(OWNER_ID, "wrong-master", { isOwner: true });
  f.panel.verifyTransferCode(OWNER_ID, FAKE_TRANSFER_CODE);
  f.panel.verifyTransferCode(OWNER_ID, "wrong-transfer");
  const all = JSON.stringify(f.logs);
  assert.ok(!all.includes(FAKE_PANEL_CODE), "panel code never logged");
  assert.ok(!all.includes(FAKE_TRANSFER_CODE), "transfer code never logged");
  assert.ok(!all.includes("wrong-master"), "wrong attempts never logged");
  assert.ok(!all.includes("wrong-transfer"), "wrong attempts never logged");
});

// 20. Aucun secret en clair dans les constantes ni dans .env.example.
test("policy constants hold no secret strings and .env.example stays empty", () => {
  const fs = require("node:fs");
  for (const [key, value] of Object.entries(OwnerPanelPolicy)) {
    assert.ok(typeof value === "number" || value instanceof RegExp, `${key} must not hold a secret string`);
  }
  const env = fs.readFileSync(".env.example", "utf8");
  for (const name of ["CIVRAT_OWNER_ID", "OWNER_PANEL_MASTER_CODE", "OWNER_TRANSFER_CODE"]) {
    assert.match(env, new RegExp(`^${name}=\\s*$`, "m"), `${name} must stay empty`);
  }
});
