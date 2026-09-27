"use strict";

/**
 * P5 — runtime `createSecurityRuntime` : rafales de modifications NON
 * permission (channelUpdate / roleUpdate) — ALERT-ONLY.
 *
 * Verrouille :
 *  • porte `security_enabled` / `security_anti_nuke` ;
 *  • sous-seuil / seuil / 1 alerte par fenêtre ;
 *  • payload `security_update` complet (subtype, moderator fail-closed,
 *    target, reason, rule, rules) ;
 *  • indépendance P2-B / P5 sur une update mixte (permissions + nom) ;
 *  • position de rôle (4e argument) comptée même sans clé de roleChanges ;
 *  • non-blocant quand la journalisation d'alerte lève ;
 *  • rendu RÉEL du payload via le transport (titre FR/EN, couleur,
 *    unrecognizedDetailKeys === []).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSecurityRuntime } = require("../runtime/createSecurityRuntime");
const { SecurityAlertSuppression } = require("../services/SecurityAlertSuppression");
const { SecurityPermsService } = require("../services/SecurityPermsService");
const { SecurityUpdateService } = require("../services/SecurityUpdateService");
const { DiscordLogsTransport, unrecognizedDetailKeys, LOG_COLORS } = require("../../../adapters/discord/DiscordLogsTransport");
const { I18nService } = require("../../../core/i18n");

const ACTOR = { executor: "Alice#0001 (u1)", executorId: "u1", reason: null };
const NO_ACTOR = { executor: null, executorId: null, reason: null };

function makeRole(id, guildId, name = "Mod") {
  return { id, name, guild: { id: guildId } };
}

function makeChannel(id, guildId, name = `chan-${id}`) {
  return { id, name, guild: { id: guildId } };
}

function makeRuntime({ clock, config = {}, throwOnLog = false } = {}) {
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
    updateService: new SecurityUpdateService({ clock }),
    logsRuntimeFactory: () => ({
      disabled: false,
      handleModerationEvent: async (event) => {
        if (throwOnLog) throw new Error("log failure");
        emitted.push(event);
      },
    }),
  });
  return { runtime, emitted };
}

const nameChange = [{ key: "name", before: "a", after: "b" }];
const permsOnly = [{ key: "permissions", before: ["ViewChannel"], after: ["ViewChannel", "Administrator"] }];
const mixedChanges = [
  { key: "permissions", before: ["ViewChannel"], after: ["ViewChannel", "ManageGuild"] },
  { key: "name", before: "général", after: "GÉNÉRAL" },
];

// ─────────────────────────────────────────────────────────────────────
// Portes de configuration
// ─────────────────────────────────────────────────────────────────────

test("P5: security désactivé ou anti-nuke coupé → SECURITY_DISABLED, aucun signal", async () => {
  let now = 0;
  const off = makeRuntime({ clock: () => now, config: { security_enabled: false } });
  const r1 = await off.runtime.handleChannelContentUpdate(makeChannel("c1", "g1"), nameChange, ACTOR);
  assert.equal(r1.handled, false);
  assert.equal(r1.code, "SECURITY_DISABLED");
  assert.equal(off.emitted.length, 0);

  const noNuke = makeRuntime({ clock: () => now, config: { security_anti_nuke: false } });
  const r2 = await noNuke.runtime.handleRoleContentUpdate(makeRole("r1", "g1"), nameChange, ACTOR, false);
  assert.equal(r2.code, "SECURITY_DISABLED");
  assert.equal(noNuke.emitted.length, 0);

  const noGuild = await off.runtime.handleChannelContentUpdate(null, nameChange, ACTOR);
  assert.equal(noGuild.code, "GUILD_MISSING");
});

// ─────────────────────────────────────────────────────────────────────
// Canal — 10 salons distincts / 15 s
// ─────────────────────────────────────────────────────────────────────

test("P5 canal: 9 salons → sous-seuil ; 10e → UNE alerte security_update CHANNEL_BURST", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });

  for (let i = 1; i <= 9; i += 1) {
    now += 100;
    const res = await runtime.handleChannelContentUpdate(makeChannel(`c${i}`, "g1"), nameChange, ACTOR);
    assert.equal(res.handled, true);
    assert.equal(res.contentBurst.triggered, false, `${i}/10 : sous-seuil`);
  }
  assert.equal(emitted.length, 0);

  now += 100;
  const tenth = await runtime.handleChannelContentUpdate(makeChannel("c10", "g1"), nameChange, ACTOR);
  assert.equal(tenth.contentBurst.triggered, true, "10/10");
  assert.equal(emitted.length, 1);

  const alert = emitted[0];
  assert.equal(alert.action, "security_update");
  assert.equal(alert.subtype, "channelUpdate");
  assert.equal(alert.moderator, ACTOR.executor);
  assert.equal(alert.moderatorId, "u1");
  assert.equal(alert.targetId, "c10");
  assert.match(alert.target, /c10/);
  assert.match(alert.reason, /Channel updates burst 10\/10 in 15000ms/);
  assert.equal(alert.rule, "SECURITY_UPDATES_CHANNEL_BURST");
  assert.deepEqual(alert.rules, ["SECURITY_UPDATES"]);

  // 11e event dans la même fenêtre → pas de spam.
  now += 100;
  await runtime.handleChannelContentUpdate(makeChannel("c2", "g1"), nameChange, ACTOR);
  assert.equal(emitted.length, 1, "une seule alerte par fenêtre");
});

test("P5 canal: uniquement `permissions` → P5 NON alimenté (contentBurst null)", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const res = await runtime.handleChannelContentUpdate(makeChannel("c1", "g1"), permsOnly, ACTOR);
  assert.equal(res.handled, true);
  assert.equal(res.contentBurst, null, "clé permissions seule → domaine P2-B");
  assert.equal(emitted.length, 0);
});

test("P5 indépendance: update mixte (permissions + nom) alimente P2-B ET P5, 2 règles distinctes", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });

  for (let i = 1; i <= 10; i += 1) {
    now += 100;
    // P2-B traite les permissions ; P5 traite la composante non-permission.
    const perms = await runtime.handleChannelPermsUpdate(makeChannel(`c${i}`, "g1"), mixedChanges, ACTOR);
    const content = await runtime.handleChannelContentUpdate(makeChannel(`c${i}`, "g1"), mixedChanges, ACTOR);
    if (i <= 5) assert.equal(perms.channelBurst.triggered, i === 5, "P2-B : 5/5 à la 5e");
    if (i >= 6) assert.equal(perms.channelBurst.triggered, false, "P2-B : alerted, pas de spam");
    assert.equal(content.contentBurst.triggered, i === 10, "P5 : 10/10 à la 10e");
  }

  const rules = new Set(emitted.map((e) => e.rule));
  assert.ok(rules.has("SECURITY_PERMS_CHANNEL_BURST"), "P2-B présent");
  assert.ok(rules.has("SECURITY_UPDATES_CHANNEL_BURST"), "P5 présent");
  assert.equal(emitted.filter((e) => e.rule === "SECURITY_UPDATES_CHANNEL_BURST").length, 1);
});

test("P5 canal: acteur inconnu → moderator/moderatorId null (fail-closed)", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  for (let i = 1; i <= 10; i += 1) {
    now += 50;
    await runtime.handleChannelContentUpdate(makeChannel(`c${i}`, "g1"), nameChange, NO_ACTOR);
  }
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].moderator, null);
  assert.equal(emitted[0].moderatorId, null);
  assert.equal(emitted[0].targetId, "c10", "la cible reste connue");
});

// ─────────────────────────────────────────────────────────────────────
// Rôle — 6 distincts / 15 s + position
// ─────────────────────────────────────────────────────────────────────

test("P5 rôle: 5/6 → sous-seuil ; 6/6 → UNE alerte ROLE_BURST ; rôle répété ≠ plusieurs", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });

  for (let i = 1; i <= 5; i += 1) {
    now += 100;
    const res = await runtime.handleRoleContentUpdate(makeRole(`r${i}`, "g1"), nameChange, ACTOR, false);
    assert.equal(res.contentBurst.triggered, false, `${i}/6`);
  }
  assert.equal(emitted.length, 0);

  // Répétition du rôle 1 → compteur inchangé.
  now += 100;
  const repeat = await runtime.handleRoleContentUpdate(makeRole("r1", "g1"), nameChange, ACTOR, false);
  assert.equal(repeat.contentBurst.distinct, 5);

  now += 100;
  const sixth = await runtime.handleRoleContentUpdate(makeRole("r6", "g1"), nameChange, ACTOR, false);
  assert.equal(sixth.contentBurst.triggered, true, "6/6");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].action, "security_update");
  assert.equal(emitted[0].subtype, "roleUpdate");
  assert.equal(emitted[0].rule, "SECURITY_UPDATES_ROLE_BURST");
  assert.deepEqual(emitted[0].rules, ["SECURITY_UPDATES"]);
  assert.equal(emitted[0].targetId, "r6");
  assert.match(emitted[0].reason, /Role updates burst 6\/6 in 15000ms/);
  assert.equal(emitted[0].moderator, ACTOR.executor);
});

test("P5 rôle: position changée SANS clé de roleChanges → compté ; position inchangée sans autre clé → rien", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });

  // Position-seule (changes []) : le flag positionChanged porte le signal.
  const positioned = await runtime.handleRoleContentUpdate(makeRole("r1", "g1"), [], ACTOR, true);
  assert.equal(positioned.contentBurst.distinct, 1, "la position seule alimente P5");

  // Aucune clé, position inchangée → aucun signal.
  const nothing = await runtime.handleRoleContentUpdate(makeRole("r2", "g1"), [], ACTOR, false);
  assert.equal(nothing.contentBurst, null);
  assert.equal(emitted.length, 0);
});

test("P5 rôle: uniquement `permissions` → P5 NON alimenté", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });
  const res = await runtime.handleRoleContentUpdate(makeRole("r1", "g1"), permsOnly, ACTOR, false);
  assert.equal(res.contentBurst, null, "domaine P2-B");
  assert.equal(emitted.length, 0);
});

// ─────────────────────────────────────────────────────────────────────
// Robustesse / rendu
// ─────────────────────────────────────────────────────────────────────

test("P5: échec de la journalisation d'alerte → non bloquant (aucune exception)", async () => {
  let now = 0;
  const { runtime } = makeRuntime({ clock: () => now, throwOnLog: true });
  let threw = false;
  try {
    for (let i = 1; i <= 10; i += 1) {
      await runtime.handleChannelContentUpdate(makeChannel(`c${i}`, "g1"), nameChange, ACTOR);
    }
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "emitAlert avale l'erreur et logge (best-effort)");
});

test("P5 rendu: le payload security_update s'affiche via le transport (titre FR/EN, couleur, champs)", async () => {
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
    action: "security_update",
    title: "Sécurité : Updates",
    details: {
      who: ACTOR.executor,
      target: "#staff (c9)",
      targetId: "c9",
      moderatorId: "u1",
      reason: "Channel updates burst 10/10 in 15000ms",
      rule: "SECURITY_UPDATES_CHANNEL_BURST",
      rules: ["SECURITY_UPDATES"],
    },
  };

  // Aucune clé de détail n'échappe au rendu (pas de mapping manquant).
  assert.deepEqual(unrecognizedDetailKeys(entry), []);

  await transport.deliver(entry);
  assert.equal(sent.length, 1);
  const embed = sent[0];
  assert.equal(embed.title, "Sécurité : Updates");
  assert.equal(embed.color, 0xc0392b, "couleur de la charte Security");
  assert.equal(LOG_COLORS.security_update, "#C0392B");

  const fieldNames = embed.fields.map((f) => f.name);
  assert.ok(fieldNames.includes("👤 Qui"), `champs: ${fieldNames.join(", ")}`);
  assert.ok(fieldNames.includes("🎯 Cible"));
  assert.ok(fieldNames.includes("💬 Raison"));
  assert.ok(fieldNames.includes("📏 Règle"));
  const who = embed.fields.find((f) => f.name === "👤 Qui");
  assert.match(who.value, /Alice#0001/);
});

test("P5 i18n: logs.security_update existe en FR et EN", () => {
  const fr = require("../../logs/translations/fr.json");
  const en = require("../../logs/translations/en.json");
  assert.equal(fr.logs.security_update, "Sécurité : Updates");
  assert.equal(en.logs.security_update, "Security: Updates");
  const i18n = new I18nService({ dictionaries: { fr, en } });
  assert.equal(i18n.translate("fr", "logs.security_update"), "Sécurité : Updates");
  assert.equal(i18n.translate("en", "logs.security_update"), "Security: Updates");
});
