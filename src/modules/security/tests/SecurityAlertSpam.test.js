"use strict";

/**
 * PHASE 1 — anti-spam des alertes Security.
 *
 * Scénario de référence : un raid de 20 membres au-dessus d'un seuil de 5 doit
 * produire UNE alerte cohérente, pas 16 embeds identiques. Une nouvelle fenêtre
 * réellement distincte doit pouvoir alerter à nouveau, et deux serveurs ne
 * doivent jamais s'influencer.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSecurityRuntime } = require("../runtime/createSecurityRuntime");
const { SecurityAlertSuppression } = require("../services/SecurityAlertSuppression");
const { SecurityRaidDefaults, SecurityNukeDefaults } = require("../configuration/securityConstants");

function makeRuntime({ clock, logs, config = {} } = {}) {
  const emitted = [];
  const runtime = createSecurityRuntime({
    configService: {
      read: async () => ({
        security_enabled: true,
        security_anti_raid: true,
        security_anti_bot: false,
        security_whitelist: [],
        security_anti_nuke: true,
        ...config,
      }),
    },
    alertSuppression: new SecurityAlertSuppression({ clock }),
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (event) => { emitted.push(event); if (logs) logs.push(event); } }),
  });
  return { runtime, emitted };
}

function member(guildId, userId) {
  return { id: userId, guild: { id: guildId }, user: { bot: false } };
}

test("PHASE1: un raid de 20 membres au-dessus du seuil produit UNE seule alerte", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });

  for (let i = 0; i < 20; i += 1) {
    now += 100; // 20 arrivées en 2 s, donc une seule fenêtre de 15 s
    const result = await runtime.handleMemberJoined(member("g-raid", `u${i}`));
    if (i >= SecurityRaidDefaults.THRESHOLD - 1) assert.equal(result.raid.isRaid, true, `détection active à l'arrivée ${i + 1}`);
  }

  assert.equal(emitted.length, 1, `une seule alerte attendue, ${emitted.length} obtenues`);
  assert.equal(emitted[0].action, "security_raid");
});

test("PHASE1: une nouvelle fenêtre réellement distincte peut alerter à nouveau", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });

  for (let i = 0; i < 6; i += 1) {
    now += 100;
    await runtime.handleMemberJoined(member("g-raid-2", `u${i}`));
  }
  assert.equal(emitted.length, 1, "première fenêtre : une alerte");

  // On sort largement de la fenêtre de détection ET de la suppression.
  now += SecurityRaidDefaults.WINDOW_MS * 2;

  for (let i = 0; i < 6; i += 1) {
    now += 100;
    await runtime.handleMemberJoined(member("g-raid-2", `v${i}`));
  }
  assert.equal(emitted.length, 2, "seconde fenêtre distincte : une nouvelle alerte");
});

test("PHASE1: la suppression est strictement indépendante par guild_id", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });

  for (let i = 0; i < SecurityRaidDefaults.THRESHOLD; i += 1) {
    now += 100;
    await runtime.handleMemberJoined(member("g-A", `a${i}`));
  }
  assert.equal(emitted.length, 1);

  // Le serveur B démarre son propre raid dans la même fenêtre temporelle.
  for (let i = 0; i < SecurityRaidDefaults.THRESHOLD; i += 1) {
    now += 100;
    await runtime.handleMemberJoined(member("g-B", `b${i}`));
  }
  assert.equal(emitted.length, 2, "le serveur B n'est pas silencié par le serveur A");
});

test("PHASE1: un nuke massif ne produit pas des dizaines d'alertes identiques", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });

  for (let i = 0; i < 40; i += 1) {
    now += 50;
    await runtime.handleChannelCreate({ guild: { id: "g-nuke" } });
  }
  assert.equal(emitted.length, 1, `une seule alerte de nuke, ${emitted.length} obtenues`);
  assert.equal(emitted[0].action, "security_nuke");
});

test("PHASE1: chaque nature de nuke a sa propre fenêtre d'alerte", async () => {
  let now = 0;
  const { runtime, emitted } = makeRuntime({ clock: () => now });

  for (let i = 0; i < SecurityNukeDefaults.THRESHOLDS.channelCreate; i += 1) {
    now += 50;
    await runtime.handleChannelCreate({ guild: { id: "g-mix" } });
  }
  for (let i = 0; i < SecurityNukeDefaults.THRESHOLDS.roleDelete; i += 1) {
    now += 50;
    await runtime.handleRoleDelete({ guild: { id: "g-mix" }, id: `r${i}` });
  }

  assert.equal(emitted.length, 2, "channelCreate et roleDelete alertent chacun une fois");
  const rules = emitted.map((event) => event.rule).sort();
  assert.deepEqual(rules, ["SECURITY_NUKE_CHANNEL_CREATE", "SECURITY_NUKE_ROLE_DELETE"]);
});

test("PHASE1: une guilde désactivée ne déclenche ni détection ni alerte", async () => {
  const { runtime, emitted } = makeRuntime({ config: { security_enabled: false } });
  for (let i = 0; i < 20; i += 1) await runtime.handleMemberJoined(member("g-off", `u${i}`));
  assert.equal(emitted.length, 0);
});

test("PHASE1: un échec de journalisation est signalé, pas avalé silencieusement", async () => {
  const warnings = [];
  const runtime = createSecurityRuntime({
    configService: { read: async () => ({ security_enabled: true, security_anti_raid: true, security_anti_nuke: false }) },
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async () => { throw new Error("log down"); } }),
    logger: { warn: (message, meta) => warnings.push({ message, meta }) },
  });

  let threw = false;
  try {
    for (let i = 0; i < SecurityRaidDefaults.THRESHOLD; i += 1) await runtime.handleMemberJoined(member("g-err", `u${i}`));
  } catch {
    threw = true;
  }

  assert.equal(threw, false, "l'échec de log ne doit pas casser la détection");
  assert.equal(warnings.length, 1, "l'échec doit laisser une trace");
  assert.equal(warnings[0].meta.event, "security_alert_log_failed");
});

test("PHASE1: SecurityAlertSuppression borne la mémoire et se réinitialise", () => {
  let now = 0;
  const suppression = new SecurityAlertSuppression({ clock: () => now, cooldownMs: 1000 });
  assert.equal(suppression.shouldAlert("g:a"), true);
  assert.equal(suppression.shouldAlert("g:a"), false);
  now = 1000;
  assert.equal(suppression.shouldAlert("g:a"), true, "fenêtre expirée : nouvelle alerte possible");
  suppression.reset("g:a");
  assert.equal(suppression.shouldAlert("g:a"), true, "reset explicite");
  assert.equal(suppression.shouldAlert(""), false, "une clé vide n'alerte jamais");
});
