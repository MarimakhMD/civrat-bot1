"use strict";

/**
 * PHASE 1 — détection des changements réels sur rôles et salons.
 *
 * Avant cette phase, `roleUpdate` et `channelUpdate` ne comparaient que le nom :
 * couleur, hoist, mentionnable, permissions, topic, position, slowmode, NSFW et
 * catégorie étaient invisibles. Ces tests verrouillent la détection réelle, et
 * le fait que rien n'est journalisé quand rien n'a changé.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { roleChanges, channelChanges, formatChanges, permissionDiff } = require("../services/logDiffs");
const guildConfigModule = require("../../../services/guildConfig");
const { _clearCache } = require("../../../utils/auditLogCache");
const { _resetConsumed } = require("../../../utils/auditLogActor");

const originalGetGuildConfig = guildConfigModule.getGuildConfig;

const FR = { logs_enabled: true, language: "fr", log_role_update_channel_id: "CH_ROLE", log_channel_update_channel_id: "CH_CHAN" };
const EN = { ...FR, language: "en" };

function bitfield(names) {
  return { toArray: () => [...names] };
}

function makeRole(overrides = {}) {
  return {
    id: "R1",
    name: "Modérateur",
    hexColor: "#ff0000",
    color: 0xff0000,
    hoist: false,
    mentionable: false,
    permissions: bitfield(["ViewChannel", "SendMessages"]),
    guild: { id: "G1" },
    ...overrides,
  };
}

function makeChannel(overrides = {}) {
  return {
    id: "C1",
    name: "général",
    topic: "Discussion",
    position: 1,
    rateLimitPerUser: 0,
    nsfw: false,
    bitrate: undefined,
    userLimit: undefined,
    parentId: null,
    parent: null,
    type: 0,
    permissionOverwrites: { cache: new Map() },
    guild: { id: "G1" },
    ...overrides,
  };
}

function keys(changes) {
  return changes.map((change) => change.key);
}

// ─────────────────────────────────────────────────────────────
// Rôles
// ─────────────────────────────────────────────────────────────

test("PHASE1: rôle — aucun changement détecté quand rien ne bouge", () => {
  assert.deepEqual(roleChanges(makeRole(), makeRole()), []);
});

test("PHASE1: rôle — nom, couleur, hoist, mentionnable détectés séparément", () => {
  assert.deepEqual(keys(roleChanges(makeRole(), makeRole({ name: "Admin" }))), ["name"]);
  assert.deepEqual(keys(roleChanges(makeRole(), makeRole({ hexColor: "#00ff00", color: 0x00ff00 }))), ["color"]);
  assert.deepEqual(keys(roleChanges(makeRole(), makeRole({ hoist: true }))), ["hoist"]);
  assert.deepEqual(keys(roleChanges(makeRole(), makeRole({ mentionable: true }))), ["mentionable"]);
});

test("PHASE1: rôle — plusieurs changements simultanés sont tous listés", () => {
  const changes = roleChanges(makeRole(), makeRole({ name: "Admin", hoist: true, mentionable: true }));
  assert.deepEqual(keys(changes), ["name", "hoist", "mentionable"]);
});

test("PHASE1: rôle — les permissions sont comparées par ensemble, pas par ordre", () => {
  const before = makeRole({ permissions: bitfield(["ViewChannel", "SendMessages"]) });
  const sameOrderChanged = makeRole({ permissions: bitfield(["SendMessages", "ViewChannel"]) });
  assert.deepEqual(roleChanges(before, sameOrderChanged), [], "un ordre différent n'est pas un changement");

  const added = makeRole({ permissions: bitfield(["ViewChannel", "SendMessages", "KickMembers"]) });
  const changes = roleChanges(before, added);
  assert.deepEqual(keys(changes), ["permissions"]);
  assert.deepEqual(changes[0].before, ["SendMessages", "ViewChannel"]);
  assert.deepEqual(changes[0].after, ["KickMembers", "SendMessages", "ViewChannel"]);
});

test("PHASE1: rôle — une propriété illisible n'est pas devinée", () => {
  // `hexColor` absent et `color` non numérique : la couleur est exclue du diff.
  const changes = roleChanges(
    makeRole({ hexColor: undefined, color: undefined }),
    makeRole({ hexColor: "#00ff00", color: 0x00ff00 }),
  );
  assert.deepEqual(changes, [], "rien n'est inventé quand l'avant est indéterminable");
});

test("PHASE1: rôle — rendu Avant/Après localisé FR et EN", () => {
  const changes = roleChanges(makeRole(), makeRole({ name: "Admin", hoist: true }));
  const fr = formatChanges(changes, FR);
  assert.equal(fr.before, "Nom : Modérateur\nAffiché séparément : Non");
  assert.equal(fr.after, "Nom : Admin\nAffiché séparément : Oui");
  assert.equal(fr.permissions, null);

  const en = formatChanges(changes, EN);
  assert.equal(en.before, "Name : Modérateur\nDisplayed separately : No");
  assert.equal(en.after, "Name : Admin\nDisplayed separately : Yes");
});

test("PHASE1: rôle — le delta de permissions rend les ajouts et retraits", () => {
  const changes = roleChanges(
    makeRole({ permissions: bitfield(["ViewChannel", "KickMembers"]) }),
    makeRole({ permissions: bitfield(["ViewChannel", "Administrator"]) }),
  );
  const rendered = formatChanges(changes, FR);
  assert.equal(rendered.before, null, "les permissions ont leur champ dédié");
  assert.equal(rendered.after, null);
  assert.equal(rendered.permissions, "Permissions :\n+ Administrator\n− KickMembers");
});

test("PHASE1: permissionDiff ne signale rien quand les ensembles sont identiques", () => {
  assert.equal(permissionDiff(["A", "B"], ["B", "A"]), null);
  assert.equal(permissionDiff(null, ["A"]), null);
});

// ─────────────────────────────────────────────────────────────
// Salons
// ─────────────────────────────────────────────────────────────

test("PHASE1: salon — aucun changement détecté quand rien ne bouge", () => {
  assert.deepEqual(channelChanges(makeChannel(), makeChannel()), []);
});

test("PHASE1: salon — nom, topic, position, slowmode, NSFW, catégorie détectés", () => {
  assert.deepEqual(keys(channelChanges(makeChannel(), makeChannel({ name: "général-2" }))), ["name"]);
  assert.deepEqual(keys(channelChanges(makeChannel(), makeChannel({ topic: "Autre sujet" }))), ["topic"]);
  assert.deepEqual(keys(channelChanges(makeChannel(), makeChannel({ position: 5 }))), ["position"]);
  assert.deepEqual(keys(channelChanges(makeChannel(), makeChannel({ rateLimitPerUser: 30 }))), ["slowmode"]);
  assert.deepEqual(keys(channelChanges(makeChannel(), makeChannel({ nsfw: true }))), ["nsfw"]);
  assert.deepEqual(
    keys(channelChanges(makeChannel(), makeChannel({ parentId: "P1", parent: { id: "P1", name: "Staff" } }))),
    ["parent"],
  );
});

test("PHASE1: salon — les surcharges de permissions sont détectées", () => {
  const before = makeChannel();
  const after = makeChannel({
    permissionOverwrites: {
      cache: new Map([["G1", { allow: bitfield([]), deny: bitfield(["SendMessages"]) }]]),
    },
  });
  assert.deepEqual(keys(channelChanges(before, after)), ["permissions"]);
});

test("PHASE1: salon — slowmode et NSFW rendus lisiblement", () => {
  const changes = channelChanges(makeChannel(), makeChannel({ rateLimitPerUser: 30, nsfw: true, topic: null }));
  const fr = formatChanges(changes, FR);
  assert.match(fr.before, /Slowmode : 0/);
  assert.match(fr.after, /Slowmode : 30/);
  assert.match(fr.before, /NSFW : Non/);
  assert.match(fr.after, /NSFW : Oui/);
  assert.match(fr.before, /Description : Discussion/);
  assert.match(fr.after, /Description : Aucun/, "une valeur absente est nommée, pas laissée vide");
});

test("PHASE1: formatChanges sans changement ne produit rien", () => {
  assert.deepEqual(formatChanges([], FR), { before: null, after: null, permissions: null });
  assert.deepEqual(formatChanges(null, FR), { before: null, after: null, permissions: null });
});

// ─────────────────────────────────────────────────────────────
// Événements réels
// ─────────────────────────────────────────────────────────────

function makeHarness(config) {
  const sent = [];
  const cache = new Map();
  for (const channelId of ["CH_ROLE", "CH_CHAN"]) {
    cache.set(channelId, { id: channelId, isTextBased: () => true, send: async (payload) => { sent.push({ channelId, embed: payload.embeds[0].toJSON() }); return { id: "SENT" }; } });
  }
  const guild = { id: "G1", channels: { cache }, fetchAuditLogs: async () => ({ entries: { filter: () => [] } }) };
  return { guild, sent };
}

test.before(() => {
  delete require.cache[require.resolve("../../../modules/logs/runtime/getLogsRuntime")];
});

test.after(() => {
  guildConfigModule.getGuildConfig = originalGetGuildConfig;
  _clearCache();
  _resetConsumed();
});

test("PHASE1: un changement de couleur de rôle est journalisé (avant : ignoré)", async () => {
  _clearCache();
  _resetConsumed();
  const { guild, sent } = makeHarness(FR);
  guildConfigModule.getGuildConfig = async () => FR;
  delete require.cache[require.resolve("../../../modules/logs/runtime/getLogsRuntime")];

  const roleUpdate = require("../../../events/roleUpdate");
  await roleUpdate.execute(makeRole({ guild }), makeRole({ guild, hexColor: "#00ff00", color: 0x00ff00 }));

  assert.equal(sent.length, 1, "le changement de couleur produit un log");
  assert.equal(sent[0].channelId, "CH_ROLE");
  const before = sent[0].embed.fields.find((field) => field.name === "📝 Avant");
  const after = sent[0].embed.fields.find((field) => field.name === "✏️ Après");
  assert.equal(before.value, "Couleur : #ff0000", "ancienne couleur");
  assert.equal(after.value, "Couleur : #00ff00", "nouvelle couleur");
});

test("PHASE1: un changement de permissions de rôle est journalisé", async () => {
  _clearCache();
  _resetConsumed();
  const { guild, sent } = makeHarness(FR);
  guildConfigModule.getGuildConfig = async () => FR;

  const roleUpdate = require("../../../events/roleUpdate");
  await roleUpdate.execute(
    makeRole({ guild }),
    makeRole({ guild, permissions: bitfield(["ViewChannel", "SendMessages", "Administrator"]) }),
  );

  assert.equal(sent.length, 1);
  const permissionsField = sent[0].embed.fields.find((field) => field.name === "🔐 Permissions");
  assert.ok(permissionsField, "champ de permissions présent");
  assert.match(permissionsField.value, /\+ Administrator/);
});

test("PHASE1: un événement rôle sans aucun changement ne journalise rien", async () => {
  _clearCache();
  _resetConsumed();
  const { guild, sent } = makeHarness(FR);
  guildConfigModule.getGuildConfig = async () => FR;

  const roleUpdate = require("../../../events/roleUpdate");
  await roleUpdate.execute(makeRole({ guild }), makeRole({ guild }));
  assert.equal(sent.length, 0, "rien à journaliser, aucun embed");
});

test("PHASE1: logs coupés → aucune requête Audit Log pour un rôle", async () => {
  _clearCache();
  _resetConsumed();
  const { guild, sent } = makeHarness({ ...FR, logs_enabled: false });
  let auditCalls = 0;
  guild.fetchAuditLogs = async () => { auditCalls += 1; return { entries: { filter: () => [] } }; };
  guildConfigModule.getGuildConfig = async () => ({ ...FR, logs_enabled: false });

  const roleUpdate = require("../../../events/roleUpdate");
  await roleUpdate.execute(makeRole({ guild }), makeRole({ guild, name: "Admin" }));

  assert.equal(sent.length, 0);
  assert.equal(auditCalls, 0, "aucune lecture d'audit quand les logs sont coupés");
});

test("PHASE1: un changement de slowmode de salon est journalisé (avant : ignoré)", async () => {
  _clearCache();
  _resetConsumed();
  const { guild, sent } = makeHarness(FR);
  guildConfigModule.getGuildConfig = async () => FR;

  const channelUpdate = require("../../../events/channelUpdate");
  await channelUpdate.execute(makeChannel({ guild }), makeChannel({ guild, rateLimitPerUser: 30 }));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, "CH_CHAN");
  assert.ok(sent[0].embed.fields.some((field) => field.value.includes("Slowmode")));
});

test("PHASE1: un verrouillage de salon est journalisé comme changement de permissions", async () => {
  _clearCache();
  _resetConsumed();
  const { guild, sent } = makeHarness(FR);
  guildConfigModule.getGuildConfig = async () => FR;

  const locked = makeChannel({
    guild,
    permissionOverwrites: { cache: new Map([["G1", { allow: bitfield([]), deny: bitfield(["SendMessages"]) }]]) },
  });

  const channelUpdate = require("../../../events/channelUpdate");
  await channelUpdate.execute(makeChannel({ guild }), locked);

  assert.equal(sent.length, 1, "le verrouillage produit un log de salon");
  const permissionsField = sent[0].embed.fields.find((field) => field.name === "🔐 Permissions");
  assert.ok(permissionsField, "le delta de permissions est rendu");
});

test("PHASE1: un changement de catégorie de salon est journalisé", async () => {
  _clearCache();
  _resetConsumed();
  const { guild, sent } = makeHarness(EN);
  guildConfigModule.getGuildConfig = async () => EN;

  const channelUpdate = require("../../../events/channelUpdate");
  await channelUpdate.execute(
    makeChannel({ guild }),
    makeChannel({ guild, parentId: "P1", parent: { id: "P1", name: "Staff" } }),
  );

  assert.equal(sent.length, 1);
  const before = sent[0].embed.fields.find((field) => field.name === "📝 Before");
  const after = sent[0].embed.fields.find((field) => field.name === "✏️ After");
  assert.ok(before && after, "libellés anglais");
  assert.match(after.value, /Category : #Staff/);
});
