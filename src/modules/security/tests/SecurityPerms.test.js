"use strict";

/**
 * P2-B — runtime `createSecurityRuntime` : signaux permissions ALERT-ONLY.
 *
 * Verrouille, au niveau du runtime (vrai `createSecurityRuntime`, logs capturés
 * en mémoire, horloge injectée) :
 *  • N1 — gain d'une permission sensible sur un rôle (dont `@everyone`) →
 *    UNE alerte `SECURITY_PERMS_ROLE_ESCALATION` par cible et par fenêtre ;
 *    une perte, une couleur ou un nom ne déclenchent JAMAIS N1 ;
 *  • rafale canal — 5 salons distincts / 15 s → `SECURITY_PERMS_CHANNEL_BURST`,
 *    4 jamais, 6e sans spam, nom/topic sans effet, isolation par guild ;
 *  • rafale rôle — 3 rôles distincts / 15 s → `SECURITY_PERMS_ROLE_BURST`,
 *    un rôle répété ne compte pas ;
 *  • payload minimal : moderator, moderatorId, targetId, target, reason, rule,
 *    rules — acteur inconnu → `null` (fail-closed, rien d'inventé) ;
 *  • porte `security_enabled` / `security_anti_nuke` respectée ;
 *  • rendu RÉEL du payload via le transport (titre, couleur, champs).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSecurityRuntime } = require("../runtime/createSecurityRuntime");
const { SecurityAlertSuppression } = require("../services/SecurityAlertSuppression");
const { SecurityPermsService } = require("../services/SecurityPermsService");
const { SecurityPermsDefaults } = require("../configuration/securityConstants");
const { roleChanges, channelChanges } = require("../../logs/services/logDiffs");
const { DiscordLogsTransport, unrecognizedDetailKeys } = require("../../../adapters/discord/DiscordLogsTransport");

function bitfield(names) {
  return { toArray: () => [...names] };
}

function makeRole(id, guildId, names, name = "Mod") {
  return { id, name, guild: { id: guildId }, permissions: bitfield(names) };
}

function makeChannel(id, guildId, overwrites) {
  return {
    id,
    name: `chan-${id}`,
    guild: { id: guildId },
    permissionOverwrites: { cache: overwrites instanceof Map ? overwrites : new Map() },
  };
}

const ACTOR = { executor: "Alice#0001 (u1)", executorId: "u1", reason: null };
const NO_ACTOR = { executor: null, executorId: null, reason: null };

function makeRuntime({ clock, config = {} } = {}) {
  const emitted = [];
  const runtime = createSecurityRuntime({
    configService: {
      read: async () => ({
        security_enabled: true,
        security_anti_raid: false,
        security_anti_bot: false,
        security_whitelist: [],
        security_anti_nuke: true,
        ...config,
      }),
    },
    alertSuppression: new SecurityAlertSuppression({ clock }),
    permsService: new SecurityPermsService({ clock }),
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (event) => { emitted.push(event); } }),
  });
  return { runtime, emitted };
}

const permsChange = (before, after) => [{ key: "permissions", before, after }];

// ─────────────────────────────────────────────────────────────────────
// N1 — signal fort : gain de permission sensible
// ─────────────────────────────────────────────────────────────────────

test("P2B N1: gain d'Administrator sur un rôle → UNE alerte SECURITY_PERMS_ROLE_ESCALATION", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const role = makeRole("r1", "g1", ["ViewChannel"]);
  const changes = roleChanges(role, makeRole("r1", "g1", ["ViewChannel", "Administrator"]));

  const result = await runtime.handleRolePermsUpdate(role, changes, ACTOR);

  assert.equal(result.handled, true);
  assert.deepEqual(result.gained, ["Administrator"]);
  assert.equal(emitted.length, 1);
  const alert = emitted[0];
  assert.equal(alert.action, "security_perms");
  assert.equal(alert.rule, "SECURITY_PERMS_ROLE_ESCALATION");
  assert.deepEqual(alert.rules, ["SECURITY_PERMS"]);
  assert.equal(alert.moderator, ACTOR.executor, "acteur affichable");
  assert.equal(alert.moderatorId, "u1", "id de l'acteur");
  assert.equal(alert.targetId, "r1");
  assert.equal(alert.target, "@Mod (r1)");
  assert.match(alert.reason, /Administrator/);
});

test("P2B N1: @everyone (id = guild) est couvert", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const everyone = makeRole("g1", "g1", ["ViewChannel"], "everyone");
  const changes = roleChanges(everyone, makeRole("g1", "g1", ["ViewChannel", "ManageGuild"], "everyone"));

  await runtime.handleRolePermsUpdate(everyone, changes, ACTOR);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].targetId, "g1");
  assert.equal(emitted[0].rule, "SECURITY_PERMS_ROLE_ESCALATION");
});

test("P2B N1: une PERTE de permission sensible → aucune alerte N1", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const role = makeRole("r1", "g1", ["Administrator", "ManageGuild"]);
  const changes = roleChanges(role, makeRole("r1", "g1", ["ManageGuild"]));

  const result = await runtime.handleRolePermsUpdate(role, changes, ACTOR);
  assert.deepEqual(result.gained, []);
  assert.equal(emitted.length, 0, "une perte n'est pas un signal N1");
});

test("P2B N1: changement de couleur/nom sans permissions → aucune détection, compteur intact", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const role = { id: "r1", name: "Mod", hexColor: "#ff0000", color: 0xff0000, hoist: false, mentionable: false, guild: { id: "g1" } };
  const role2 = { ...role, hexColor: "#00ff00", color: 0x00ff00, name: "Admin" };
  const changes = roleChanges(role, role2);

  const result = await runtime.handleRolePermsUpdate(role2, changes, ACTOR);
  assert.equal(result.handled, true);
  assert.equal(result.roleBurst, null, "pas d'entrée permissions → pas de compteur");
  assert.equal(emitted.length, 0);
});

test("P2B N1: même rôle en boucle dans la fenêtre → UNE seule alerte", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const role = makeRole("r1", "g1", ["ViewChannel"]);
  const changes = permsChange(["ViewChannel"], ["ViewChannel", "Administrator"]);

  for (let i = 0; i < 5; i += 1) {
    now += 10;
    await runtime.handleRolePermsUpdate(role, changes, ACTOR);
  }
  assert.equal(emitted.length, 1, "pas de boucle d'alertes identiques");
});

test("P2B N1: deux cibles différentes → une alerte par cible (clés indépendantes)", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const changes = permsChange([], ["ManageChannels"]);
  await runtime.handleRolePermsUpdate(makeRole("r1", "g1", []), changes, ACTOR);
  await runtime.handleRolePermsUpdate(makeRole("r2", "g1", []), changes, ACTOR);
  assert.equal(emitted.length, 2, "deux rôles distincts = deux signaux");
  const targets = emitted.map((e) => e.targetId).sort();
  assert.deepEqual(targets, ["r1", "r2"]);
});

test("P2B N1: acteur inconnu → moderator/moderatorId null (fail-closed)", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const role = makeRole("r1", "g1", []);
  await runtime.handleRolePermsUpdate(role, permsChange([], ["BanMembers"]), NO_ACTOR);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].moderator, null);
  assert.equal(emitted[0].moderatorId, null);
  assert.equal(emitted[0].targetId, "r1", "la cible reste connue");
});

// ─────────────────────────────────────────────────────────────────────
// Rafale de salons — 5 distincts / 15 s
// ─────────────────────────────────────────────────────────────────────

test("P2B canal: 4 salons distincts → aucune alerte ; 5e → UNE alerte CHANNEL_BURST", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const changes = channelChanges(
    makeChannel("c0", "g1"),
    makeChannel("c0", "g1", new Map([["R1", { allow: bitfield([]), deny: bitfield(["SendMessages"]) }]])),
  );
  assert.ok(changes.some((c) => c.key === "permissions"), "prérequis : la modification produit bien la clé permissions");

  for (let i = 1; i <= 4; i += 1) {
    now += 100;
    const res = await runtime.handleChannelPermsUpdate(makeChannel(`c${i}`, "g1"), changes, ACTOR);
    assert.equal(res.channelBurst.triggered, false, `${i}/5 : pas d'alerte`);
  }
  assert.equal(emitted.length, 0);

  const fifth = await runtime.handleChannelPermsUpdate(makeChannel("c5", "g1"), changes, ACTOR);
  assert.equal(fifth.channelBurst.triggered, true, "5/5");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].action, "security_perms");
  assert.equal(emitted[0].rule, "SECURITY_PERMS_CHANNEL_BURST");
  assert.equal(emitted[0].targetId, "c5");
  assert.equal(emitted[0].moderator, ACTOR.executor);
  assert.match(emitted[0].reason, /5\/5/);
});

test("P2B canal: 6e salon dans la même fenêtre → pas de spam", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const changes = permsChange([], []);
  for (let i = 1; i <= 6; i += 1) {
    now += 100;
    await runtime.handleChannelPermsUpdate(makeChannel(`c${i}`, "g1"), changes, ACTOR);
  }
  assert.equal(emitted.length, 1, "une seule alerte par fenêtre");
});

test("P2B canal: MÊME salon modifié 6 fois → aucune alerte (distincts uniquement)", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const changes = permsChange([], []);
  for (let i = 0; i < 6; i += 1) {
    now += 100;
    await runtime.handleChannelPermsUpdate(makeChannel("cSame", "g1"), changes, ACTOR);
  }
  assert.equal(emitted.length, 0, "1 seul salon distinct = 1/5");
});

test("P2B canal: modifications SANS permissions (nom/topic/slowmode…) n'alimentent pas le compteur", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const nameOnly = [{ key: "name", before: "a", after: "b" }];
  const topicOnly = [{ key: "topic", before: "t", after: "t2" }];
  const slowOnly = [{ key: "slowmode", before: 0, after: 30 }];
  for (let i = 1; i <= 10; i += 1) {
    now += 100;
    const res = await runtime.handleChannelPermsUpdate(makeChannel(`c${i}`, "g1"), i % 3 === 0 ? nameOnly : i % 3 === 1 ? topicOnly : slowOnly, ACTOR);
    assert.equal(res.channelBurst, null, "aucune entrée permissions → compteur non touché");
  }
  assert.equal(emitted.length, 0);
});

test("P2B canal: fenêtre expirée → nouvelle rafale possible ; guilds isolés", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const changes = permsChange([], []);

  for (let i = 1; i <= 5; i += 1) {
    now += 100;
    await runtime.handleChannelPermsUpdate(makeChannel(`a${i}`, "gA"), changes, ACTOR);
  }
  assert.equal(emitted.length, 1, "gA alerté");

  // gB, même instant : propre compteur, même fenêtre.
  for (let i = 1; i <= 5; i += 1) {
    now += 100;
    await runtime.handleChannelPermsUpdate(makeChannel(`b${i}`, "gB"), changes, ACTOR);
  }
  assert.equal(emitted.length, 2, "gB finit SES 5 salons → alerte, isolé de gA");

  // Fenêtre gA réellement expirée → réarmement.
  now += SecurityPermsDefaults.WINDOW_MS + 1000;
  for (let i = 1; i <= 5; i += 1) {
    await runtime.handleChannelPermsUpdate(makeChannel(`z${i}`, "gA"), changes, ACTOR);
  }
  assert.equal(emitted.length, 3, "nouvelle fenêtre gA : nouvelle alerte");
});

// ─────────────────────────────────────────────────────────────────────
// Rafale de rôles — 3 distincts / 15 s
// ─────────────────────────────────────────────────────────────────────

test("P2B rafale rôle: 2 rôles → rien ; 3e → UNE alerte ROLE_BURST ; répétitions ignorées", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const changes = permsChange(["SendMessages"], ["SendMessages", "ViewChannel"]);

  const r1 = await runtime.handleRolePermsUpdate(makeRole("r1", "g1", ["SendMessages"]), changes, ACTOR);
  const r2 = await runtime.handleRolePermsUpdate(makeRole("r2", "g1", ["SendMessages"]), changes, ACTOR);
  assert.equal(r1.roleBurst.triggered, false);
  assert.equal(r2.roleBurst.triggered, false);
  assert.equal(emitted.length, 0, "2 rôles distincts : pas d'alerte");

  // Le MÊME rôle répété ne fait pas artificiellement monter le compteur.
  const repeat = await runtime.handleRolePermsUpdate(makeRole("r1", "g1", ["SendMessages"]), changes, ACTOR);
  assert.equal(repeat.roleBurst.distinct, 2, "toujours 2 distincts");
  assert.equal(emitted.length, 0);

  const r3 = await runtime.handleRolePermsUpdate(makeRole("r3", "g1", ["SendMessages"]), changes, ACTOR);
  assert.equal(r3.roleBurst.triggered, true, "3 rôles distincts");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].rule, "SECURITY_PERMS_ROLE_BURST");

  const r4 = await runtime.handleRolePermsUpdate(makeRole("r4", "g1", ["SendMessages"]), changes, ACTOR);
  assert.equal(r4.roleBurst.triggered, false, "6e-style : pas de spam");
  assert.equal(emitted.length, 1);
});

test("P2B combiné:3e rôle gagne une permission sensible → alerte N1 ET rafale (2 règles)", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const escalation = permsChange([], ["KickMembers"]);

  await runtime.handleRolePermsUpdate(makeRole("r1", "g1", []), permsChange([], ["ViewChannel"]), ACTOR);
  await runtime.handleRolePermsUpdate(makeRole("r2", "g1", []), permsChange([], ["ViewChannel"]), ACTOR);
  await runtime.handleRolePermsUpdate(makeRole("r3", "g1", []), escalation, ACTOR);

  const rules = emitted.map((e) => e.rule).sort();
  assert.deepEqual(rules, ["SECURITY_PERMS_ROLE_BURST", "SECURITY_PERMS_ROLE_ESCALATION"]);
});

// ─────────────────────────────────────────────────────────────────────
// Portes de configuration
// ─────────────────────────────────────────────────────────────────────

test("P2B: guilde désactivée ou anti-nuke coupé → ni détection ni alerte", async () => {
  let now = 0;
  const off = makeRuntime({ clock: () => now, config: { security_enabled: false } });
  const changes = permsChange([], ["Administrator"]);
  const res1 = await off.runtime.handleRolePermsUpdate(makeRole("r1", "g1", []), changes, ACTOR);
  assert.equal(res1.handled, false);
  assert.equal(res1.code, "SECURITY_DISABLED");
  assert.equal(off.emitted.length, 0);

  const noNuke = makeRuntime({ clock: () => now, config: { security_anti_nuke: false } });
  const res2 = await noNuke.runtime.handleChannelPermsUpdate(makeChannel("c1", "g1"), changes, ACTOR);
  assert.equal(res2.code, "SECURITY_DISABLED");
  assert.equal(noNuke.emitted.length, 0);

  const noGuild = await off.runtime.handleRolePermsUpdate(null, changes, ACTOR);
  assert.equal(noGuild.code, "GUILD_MISSING");
});

// ─────────────────────────────────────────────────────────────────────
// Rendu réel du payload (transport)
// ─────────────────────────────────────────────────────────────────────

test("P2B rendu: le payload security_perms s'affiche via le transport (titre, couleur, acteur, cible)", async () => {
  const sent = [];
  const cache = new Map([["CH1", {
    id: "CH1",
    isTextBased: () => true,
    send: async (payload) => { sent.push(payload.embeds[0].toJSON()); return { id: "SENT" }; },
  }]]);
  const transport = new DiscordLogsTransport({ guild: { id: "g1", channels: { cache } } });

  const entry = {
    guildId: "g1",
    channelId: "CH1",
    category: "moderation",
    language: "fr",
    action: "security_perms",
    title: "Sécurité : Permissions",
    details: {
      who: ACTOR.executor,
      target: "@Mod (r1)",
      targetId: "r1",
      moderatorId: "u1",
      reason: "Permissions gained: Administrator",
      rule: "SECURITY_PERMS_ROLE_ESCALATION",
      rules: ["SECURITY_PERMS"],
    },
  };

  // Aucune clé de détail n'échappe au rendu (pas de mapping manquant).
  assert.deepEqual(unrecognizedDetailKeys(entry), []);

  await transport.deliver(entry);
  assert.equal(sent.length, 1);
  const embed = sent[0];
  assert.equal(embed.title, "Sécurité : Permissions");
  assert.equal(embed.color, 0xc0392b, "couleur de la charte Security");

  const fieldNames = embed.fields.map((f) => f.name);
  assert.ok(fieldNames.includes("👤 Qui"), `champs: ${fieldNames.join(", ")}`);
  assert.ok(fieldNames.includes("🎯 Cible"));
  assert.ok(fieldNames.includes("💬 Raison"));
  assert.ok(fieldNames.includes("📏 Règle"));
  const ids = embed.fields.find((f) => f.name === "🆔 IDs");
  assert.ok(ids, "champ IDs présent");
  assert.match(ids.value, /modérateur: u1/);
  assert.match(ids.value, /cible: r1/);
  const who = embed.fields.find((f) => f.name === "👤 Qui");
  assert.match(who.value, /Alice#0001/);
});

test("P2B rendu: acteur inconnu → « inconnu », jamais une identité inventée", async () => {
  const sent = [];
  const cache = new Map([["CH1", {
    id: "CH1",
    isTextBased: () => true,
    send: async (payload) => { sent.push(payload.embeds[0].toJSON()); return { id: "SENT" }; },
  }]]);
  const transport = new DiscordLogsTransport({ guild: { id: "g1", channels: { cache } } });

  await transport.deliver({
    guildId: "g1",
    channelId: "CH1",
    category: "moderation",
    language: "fr",
    action: "security_perms",
    title: "Sécurité : Permissions",
    details: {
      who: null,
      target: "#staff (c9)",
      targetId: "c9",
      reason: "Permission overwrites burst 5/5 in 15000ms",
      rule: "SECURITY_PERMS_CHANNEL_BURST",
      rules: ["SECURITY_PERMS"],
    },
  });

  assert.equal(sent.length, 1);
  const who = sent[0].fields.find((f) => f.name === "👤 Qui");
  assert.match(who.value, /inconnu/);
  const ids = sent[0].fields.find((f) => f.name === "🆔 IDs");
  assert.match(ids.value, /cible: c9/);
  assert.doesNotMatch(ids.value, /modérateur/, "pas d'id d'acteur quand il est inconnu");
});
