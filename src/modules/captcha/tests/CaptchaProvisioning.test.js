"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CaptchaProvisioningService } = require("../services/CaptchaProvisioningService");
const { CaptchaConfigKey: Key } = require("../configuration/captchaConstants");

function harness({ config, roles = new Map(), channels = new Map(), failCreateRole = false, failCreateChannel = false, failUpdate = false, everyoneId = "everyone" } = {}) {
  const calls = { createRole: [], createChannel: [], update: [], controlEdit: [] };
  let current = { ...config };
  const configService = {
    read: async () => ({ ...current }),
    update: async (_g, patch) => {
      if (failUpdate) throw new Error("column missing");
      calls.update.push(patch);
      current = { ...current, ...patch };
      return { ...current };
    },
  };
  const transport = {
    getRole: async (id) => roles.get(id) || null,
    createRole: async (name) => {
      if (failCreateRole) throw new Error("Missing Permissions");
      calls.createRole.push(name);
      const id = `role-${name.length}-${calls.createRole.length}`;
      roles.set(id, { id, position: 1, managed: false });
      return { id };
    },
    ensureChannelControl: async (channelId) => {
      const channel = channels.get(channelId);
      if (!channel) return { ok: false, reason: "captcha.channelInvalid" };
      if (channel.controlled) return { ok: true, changed: false };
      if (channel.permissionsDenied) return { ok: false, reason: "captcha.channelPermissionsMissing", error: "Missing Permissions" };
      calls.controlEdit.push(channelId);
      channel.controlled = true;
      return { ok: true, changed: true };
    },
    createCaptchaChannel: async (name) => {
      if (failCreateChannel) throw new Error("Missing Permissions");
      calls.createChannel.push(name);
      const id = `chan-${calls.createChannel.length}`;
      channels.set(id, { controlled: true });
      return { id };
    },
  };
  const service = new CaptchaProvisioningService({ configService, transport });
  return { service, calls, roles, channels, config: () => ({ ...current }), everyoneId };
}

test("provisioning creates ONLY the missing unverified role and persists its id", async () => {
  const h = harness({ config: { [Key.ENABLED]: true, [Key.UNVERIFIED_ROLE_ID]: null } });
  const result = await h.service.ensure("g");
  assert.equal(h.calls.createRole.length, 1, "un seul rôle créé");
  assert.ok(h.calls.update.length >= 1);
  assert.ok(h.config()[Key.UNVERIFIED_ROLE_ID], "l'id est persisté (source de vérité)");
  const created = result.created.find((c) => c.element === "unverifiedRole");
  assert.equal(created.id, h.config()[Key.UNVERIFIED_ROLE_ID]);
});

test("provisioning never recreates an existing element", async () => {
  const roles = new Map([["r-unv", { id: "r-unv", position: 1 }], ["r-ver", { id: "r-ver", position: 1 }]]);
  const channels = new Map([["c-1", { controlled: true }]]);
  const h = harness({
    config: { [Key.ENABLED]: true, [Key.UNVERIFIED_ROLE_ID]: "r-unv", [Key.ROLE_ID]: "r-ver", [Key.CHANNEL_ID]: "c-1" },
    roles, channels,
  });
  const result = await h.service.ensure("g");
  assert.equal(h.calls.createRole.length, 0, "aucun rôle recréé");
  assert.equal(h.calls.createChannel.length, 0, "aucun canal recréé");
  assert.equal(result.created.length, 0);
  assert.equal(result.intact.length, 3, "rôle non vérifié, rôle vérifié et canal intacts");
});

test("provisioning recreates a configured-then-deleted role only", async () => {
  const roles = new Map([["r-ver", { id: "r-ver", position: 1 }]]);
  const h = harness({ config: { [Key.ENABLED]: true, [Key.UNVERIFIED_ROLE_ID]: "r-gone", [Key.ROLE_ID]: "r-ver" }, roles });
  const result = await h.service.ensure("g");
  assert.equal(h.calls.createRole.length, 1, "seulement le rôle manquant");
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].element, "unverifiedRole");
  assert.equal(result.created[0].previousId, "r-gone");
  assert.ok(result.intact.some((i) => i.element === "verifiedRole"), "le rôle vérifié présent n'est pas touché");
  assert.notEqual(h.config()[Key.UNVERIFIED_ROLE_ID], "r-gone");
});

test("provisioning never creates an optional verified role that was never configured", async () => {
  const h = harness({ config: { [Key.ENABLED]: true, [Key.UNVERIFIED_ROLE_ID]: null, [Key.ROLE_ID]: null } });
  const result = await h.service.ensure("g");
  assert.equal(h.calls.createRole.length, 1, "seul le rôle obligatoire non vérifié");
  assert.ok(result.skipped.some((s) => s.element === "verifiedRole"));
});

test("provisioning recreates a deleted channel and keeps its own overwrite only", async () => {
  const channels = new Map();
  const h = harness({ config: { [Key.ENABLED]: true, [Key.UNVERIFIED_ROLE_ID]: "r", [Key.CHANNEL_ID]: "c-gone" }, channels, roles: new Map([["r", { id: "r", position: 1 }]]) });
  const result = await h.service.ensure("g");
  assert.equal(h.calls.createChannel.length, 1, "seulement le canal manquant");
  assert.ok(h.config()[Key.CHANNEL_ID].startsWith("chan-"), "nouvel id persisté");
  assert.ok(result.created.some((c) => c.element === "channel"));
});

test("provisioning applies a missing channel control without recreating the channel", async () => {
  const channels = new Map([["c-1", { controlled: false }]]);
  const h = harness({ config: { [Key.ENABLED]: true, [Key.UNVERIFIED_ROLE_ID]: "r", [Key.CHANNEL_ID]: "c-1" }, channels, roles: new Map([["r", { id: "r", position: 1 }]]) });
  const result = await h.service.ensure("g");
  assert.equal(h.calls.createChannel.length, 0, "canal non recréé");
  assert.deepEqual(h.calls.controlEdit, ["c-1"], "overwrite appliqué sur le canal ciblé uniquement");
  assert.equal(result.intact.find((i) => i.element === "channel").controlChanged, true);
});

test("provisioning is a no-op when captcha is disabled (and reports force on)", async () => {
  const h = harness({ config: { [Key.ENABLED]: false, [Key.UNVERIFIED_ROLE_ID]: null } });
  const idle = await h.service.ensure("g");
  assert.equal(h.calls.createRole.length, 0);
  assert.equal(idle.created.length + idle.failed.length, 0);
  const forced = await h.service.ensure("g", { force: true });
  assert.ok(forced.failed.some((f) => f.code === "captcha.forceRequiresEnabled"));
});

test("provisioning failures are clear codes, never thrown", async () => {
  const h = harness({ config: { [Key.ENABLED]: true, [Key.UNVERIFIED_ROLE_ID]: null }, failCreateRole: true });
  const result = await h.service.ensure("g");
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].code, "captcha.provision_role_failed");
  assert.match(result.failed[0].error, /Missing Permissions/);

  const h2 = harness({ config: { [Key.ENABLED]: true, [Key.UNVERIFIED_ROLE_ID]: null }, failUpdate: true });
  const result2 = await h2.service.ensure("g");
  assert.ok(result2.failed.some((f) => f.code === "captcha.provision_persist_failed"));
});

test("provisioning — persist failure never re-creates the role on the next pass (no role spam)", async () => {
  const h = harness({ config: { [Key.ENABLED]: true, [Key.UNVERIFIED_ROLE_ID]: null }, failUpdate: true });
  const first = await h.service.ensure("g-spam");
  assert.ok(first.failed.some((f) => f.code === "captcha.provision_persist_failed"));
  assert.equal(h.calls.createRole.length, 1);

  // Passé suivant (même service ou service neuf, même session) : le repli
  // mémoire empêche une seconde création tant que la colonne n'existe pas.
  const again = await h.service.ensure("g-spam");
  assert.equal(h.calls.createRole.length, 1, "aucune recréation en rafale");
  assert.ok(again.intact.some((i) => i.element === "unverifiedRole"), "élément réutilisé via le repli de session");
});

test("provisioning channel permission failure returns a clear code without touching other channels", async () => {
  const channels = new Map([["c-1", { permissionsDenied: true }]]);
  const h = harness({ config: { [Key.ENABLED]: true, [Key.UNVERIFIED_ROLE_ID]: "r", [Key.CHANNEL_ID]: "c-1" }, channels, roles: new Map([["r", { id: "r", position: 1 }]]) });
  const result = await h.service.ensure("g");
  assert.equal(h.calls.createChannel.length, 0, "pas de recréation sur erreur de permissions");
  assert.ok(result.failed.some((f) => f.element === "channel" && f.code === "captcha.provision_channel_permissions_failed"));
});
