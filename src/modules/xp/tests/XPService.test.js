"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  XPService,
  resolveXpPerMessage,
  resolveXpCooldownSeconds,
} = require("../services/XPService");
const { LevelService } = require("../services/LevelService");
const { InMemoryXPRepository } = require("../persistence/XPRepository");

test("level calculations", () => {
  const svc = new LevelService();
  assert.equal(svc.levelForXp(0), 0);
  assert.equal(svc.levelForXp(99), 0);
  assert.equal(svc.levelForXp(100), 1);
  assert.equal(svc.levelForXp(199), 1);
  assert.equal(svc.levelForXp(200), 2);
  assert.equal(svc.xpForLevel(0), 0);
  assert.equal(svc.xpForLevel(1), 100);
  assert.equal(svc.progress(150).level, 1);
  assert.equal(svc.progress(150).percent, 50);
});

test("XP ignored for bot, no guild, disabled", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo });
  assert.equal((await svc.handleMessage({ guildId: null, userId: "u", isBot: false, config: { xp_enabled: true } })).code, "XP_IGNORED");
  assert.equal((await svc.handleMessage({ guildId: "g", userId: null, isBot: false, config: { xp_enabled: true } })).code, "XP_IGNORED");
  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: true, config: { xp_enabled: true } })).code, "XP_IGNORED");
  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config: { xp_enabled: false } })).code, "XP_DISABLED");
  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config: null })).code, "XP_DISABLED");
});

// A2 (DCA3) — le gain est FIXE et vaut exactement xp_per_message.
// Il remplace l'ancien gain aléatoire 15–25 multiplié par xp_rate.
test("A2 — xp_per_message is the exact fixed gain, with no randomness", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo });
  const config = { xp_enabled: true, xp_per_message: 20, xp_cooldown: 60 };

  const first = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });
  assert.equal(first.code, "XP_GAINED");
  assert.equal(first.xpGain, 20, "le gain doit être exactement xp_per_message");
  assert.equal(first.xp, 20);

  // Même configuration, utilisateur différent : gain strictement identique.
  const other = await svc.handleMessage({ guildId: "g", userId: "u2", isBot: false, config });
  assert.equal(other.xpGain, 20, "aucune dispersion aléatoire n'est tolérée");
});

test("A2 — xp_per_message defaults to 15 when absent or null", async () => {
  for (const config of [
    { xp_enabled: true },
    { xp_enabled: true, xp_per_message: null },
    { xp_enabled: true, xp_per_message: undefined },
  ]) {
    const repo = new InMemoryXPRepository();
    const svc = new XPService({ repository: repo });
    const res = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });
    assert.equal(res.xpGain, 15, `défaut 15 attendu pour ${JSON.stringify(config)}`);
  }
});

test("A2 — xp_rate is gone and no longer multiplies the gain", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo });
  // Un patch historique contenant encore xp_rate ne doit avoir AUCUN effet :
  // la clé est ignorée, le gain reste xp_per_message.
  const res = await svc.handleMessage({
    guildId: "g",
    userId: "u",
    isBot: false,
    config: { xp_enabled: true, xp_per_message: 20, xp_rate: 5 },
  });
  assert.equal(res.xpGain, 20, "xp_rate ne doit plus influencer le gain");
});

test("A2 — xp_cooldown is read in seconds from the configuration", async () => {
  const repo = new InMemoryXPRepository();
  let now = 0;
  const svc = new XPService({ repository: repo, clock: () => now });
  const config = { xp_enabled: true, xp_per_message: 10, xp_cooldown: 5 };

  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config })).code, "XP_GAINED");

  now += 4000;
  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config })).code, "XP_COOLDOWN",
    "4 s < 5 s : encore en cooldown");

  now += 1000;
  const third = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });
  assert.equal(third.code, "XP_GAINED", "5 s atteintes : cooldown écoulé");
  assert.equal(third.xp, 20);
});

test("A2 — xp_cooldown defaults to 60 seconds", async () => {
  const repo = new InMemoryXPRepository();
  let now = 0;
  const svc = new XPService({ repository: repo, clock: () => now });
  const config = { xp_enabled: true, xp_per_message: 10 };

  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config })).code, "XP_GAINED");
  now += 59000;
  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config })).code, "XP_COOLDOWN");
  now += 1000;
  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config })).code, "XP_GAINED");
});

// A2 (DCA5) — 0 désactive totalement le cooldown.
test("A2 — xp_cooldown of 0 disables the cooldown entirely", async () => {
  const repo = new InMemoryXPRepository();
  const now = 0;
  const svc = new XPService({ repository: repo, clock: () => now });
  const config = { xp_enabled: true, xp_per_message: 10, xp_cooldown: 0 };

  const results = [];
  for (let i = 0; i < 5; i += 1) {
    results.push(await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config }));
  }
  assert.ok(results.every((r) => r.code === "XP_GAINED"), "aucun message ne doit être bloqué");
  assert.equal(results[4].xp, 50);
  assert.equal(svc.cooldowns.size, 0, "aucun cooldown désactivé ne doit être mémorisé");
});

// isOnCooldown est testé directement. Sur le chemin handleMessage un cooldown à
// 0 n'alimente jamais la Map, donc le garde interne « 0 = désactivé » n'y est
// jamais exercé.
//
// Ce garde n'est pas décoratif : Date.now() n'est PAS monotone. Après un recul
// d'horloge (NTP), l'écart devient négatif et `écart < 0` serait vrai — sans le
// garde, un cooldown à 0 bloquerait alors les messages indéfiniment.
test("A2 — isOnCooldown honours a zero cooldown, including after a clock step back", () => {
  const cooldowns = new Map();
  const svc = new XPService({ repository: new InMemoryXPRepository(), cooldowns, clock: () => 1000 });
  cooldowns.set("g:u", 0);

  assert.equal(svc.isOnCooldown("g", "u", 60), true, "avec 60 s le message est bloqué");
  assert.equal(svc.isOnCooldown("g", "u", 0), false, "0 désactive, même avec un horodatage mémorisé");
  assert.equal(svc.isOnCooldown("g", "u", -5), false, "une valeur négative est écrêtée à 0");
  assert.equal(svc.isOnCooldown("g", "u", "absurde"), true, "une valeur invalide retombe sur le défaut 60 s");
  assert.equal(svc.isOnCooldown("g", "autre", 60), false, "un utilisateur sans horodatage n'est jamais bloqué");

  // Horodatage postérieur à l'horloge : écart négatif.
  const skewed = new XPService({ repository: new InMemoryXPRepository(), cooldowns: new Map([["g:u", 5000]]), clock: () => 1000 });
  assert.equal(skewed.isOnCooldown("g", "u", 0), false,
    "un cooldown désactivé ne doit jamais bloquer, même après un recul d'horloge");
  assert.equal(skewed.isOnCooldown("g", "u", 60), true,
    "avec un cooldown actif, un écart négatif compte comme toujours en cooldown");
});

test("A2 — invalid, absurd or out-of-range values are handled without throwing", () => {
  const cases = [
    [null, 15], [undefined, 15], ["", 15], ["   ", 15], ["abc", 15], [NaN, 15], [Infinity, 15],
    [true, 15], [false, 15], [{}, 15], [[], 15], [[20], 15],
    [-5, 0], [-1000, 0], [0, 0], [15, 15], [42, 42], [7.9, 7], ["25", 25], ["  30  ", 30],
  ];
  for (const [input, expected] of cases) {
    assert.equal(resolveXpPerMessage({ xp_per_message: input }), expected,
      `xp_per_message=${JSON.stringify(input)} doit donner ${expected}`);
    assert.doesNotThrow(() => resolveXpPerMessage({ xp_per_message: input }));
  }

  const cooldowns = [
    [null, 60], [undefined, 60], ["", 60], ["   ", 60], ["abc", 60], [NaN, 60], [true, 60],
    [{}, 60], [[], 60], [[0], 60],
    [-10, 0], [0, 0], [60, 60], [3600, 3600], [99999, 3600], [Number.MAX_SAFE_INTEGER, 3600],
    [12.7, 12], ["120", 120],
  ];
  for (const [input, expected] of cooldowns) {
    assert.equal(resolveXpCooldownSeconds({ xp_cooldown: input }), expected,
      `xp_cooldown=${JSON.stringify(input)} doit donner ${expected}`);
    assert.doesNotThrow(() => resolveXpCooldownSeconds({ xp_cooldown: input }));
  }

  // Config absente ou malformée : aucun crash.
  assert.equal(resolveXpPerMessage(null), 15);
  assert.equal(resolveXpPerMessage(undefined), 15);
  assert.equal(resolveXpCooldownSeconds(null), 60);
  assert.equal(resolveXpCooldownSeconds(undefined), 60);
});

test("A2 — an absurd stored configuration still produces a safe gain and cooldown", async () => {
  const repo = new InMemoryXPRepository();
  let now = 0;
  const svc = new XPService({ repository: repo, clock: () => now });

  const res = await svc.handleMessage({
    guildId: "g",
    userId: "u",
    isBot: false,
    config: { xp_enabled: true, xp_per_message: "abc", xp_cooldown: -999 },
  });
  assert.equal(res.code, "XP_GAINED");
  assert.equal(res.xpGain, 15, "gain retombé sur le défaut");
  assert.equal(Number.isFinite(res.xp), true, "aucun NaN ne doit atteindre le dépôt");
});

test("XP level up", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo });
  const config = { xp_enabled: true, xp_per_message: 20, xp_cooldown: 0 };
  await repo.upsert("g", "u", 90, 0);
  const res = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });
  assert.equal(res.code, "XP_LEVELED_UP");
  assert.equal(res.level, 1);
  assert.equal(res.leveledUp, true);
  assert.equal(res.previousLevel, 0);
  assert.equal(res.xp, 110);
});

test("XP repository integration", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo });
  const config = { xp_enabled: true, xp_per_message: 15, xp_cooldown: 0 };
  await svc.handleMessage({ guildId: "g", userId: "u1", isBot: false, config });
  await svc.handleMessage({ guildId: "g", userId: "u2", isBot: false, config });
  const u1 = await repo.findOne("g", "u1");
  const u2 = await repo.findOne("g", "u2");
  assert.equal(u1.xp, 15);
  assert.equal(u2.xp, 15);
  assert.notEqual(u1.userId, u2.userId);
});

test("XP requires repository", () => {
  assert.throws(() => new XPService({}), /repository/);
});

// ─────────────────────────────────────────────────────────────────────────
// B3 — aiguillage entre chemin atomique et chemin historique
// ─────────────────────────────────────────────────────────────────────────

test("B3 — XPService passe par applyGain quand le dépôt le propose", async () => {
  const calls = [];
  const repository = {
    findOne: async () => { throw new Error("findOne ne doit plus être appelé sur le chemin atomique"); },
    upsert: async () => { throw new Error("upsert ne doit plus être appelé sur le chemin atomique"); },
    applyGain: async (params) => {
      calls.push(params);
      return { applied: true, xpGain: params.gain, xp: 15, level: 0, previousXp: 0, previousLevel: 0 };
    },
  };
  const svc = new XPService({ repository, clock: () => 1234 });

  const result = await svc.handleMessage({
    guildId: "g", userId: "u", isBot: false,
    config: { xp_enabled: true, xp_per_message: 15, xp_cooldown: 60 },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].gain, 15, "le gain fixe A2 doit être transmis au dépôt");
  assert.equal(calls[0].cooldownSeconds, 60, "le cooldown A2 en secondes doit être transmis");
  assert.equal(calls[0].now, 1234, "le service doit imposer son horloge au dépôt");
  assert.equal(calls[0].computeLevel(250), 2, "la formule de niveau reste dans LevelService");
  assert.equal(result.code, "XP_GAINED");
  assert.equal(result.xp, 15);
});

test("B3 — une montée de niveau est signalée depuis le résultat atomique", async () => {
  const repository = {
    findOne: async () => null,
    upsert: async () => null,
    applyGain: async () => ({ applied: true, xpGain: 20, xp: 110, level: 1, previousXp: 90, previousLevel: 0 }),
  };
  const svc = new XPService({ repository });
  const result = await svc.handleMessage({
    guildId: "g", userId: "u", isBot: false,
    config: { xp_enabled: true, xp_per_message: 20, xp_cooldown: 0 },
  });
  assert.equal(result.code, "XP_LEVELED_UP");
  assert.equal(result.leveledUp, true);
  assert.equal(result.previousLevel, 0);
});

test("B3 — un rejet du dépôt (cooldown ou conflit) ne produit aucun gain", async () => {
  for (const code of ["XP_COOLDOWN", "XP_CONFLICT"]) {
    const repository = {
      findOne: async () => null,
      upsert: async () => { throw new Error("aucune écriture ne doit suivre un rejet"); },
      applyGain: async () => ({ applied: false, code }),
    };
    const svc = new XPService({ repository });
    const result = await svc.handleMessage({
      guildId: "g", userId: "u", isBot: false,
      config: { xp_enabled: true, xp_per_message: 15, xp_cooldown: 0 },
    });
    assert.equal(result.handled, false);
    assert.equal(result.code, code, `le code ${code} doit remonter tel quel`);
  }
});

test("B3 — un dépôt sans applyGain conserve le chemin historique (compatibilité Mongo)", async () => {
  // MongoXPRepository n'implémente pas applyGain : le service doit continuer à
  // fonctionner en read-modify-write plutôt que de lever.
  const repo = new InMemoryXPRepository();
  // applyGain vit sur le prototype : `delete` ne le retirerait pas. On le masque
  // sur l'instance, ce qui reproduit exactement un dépôt qui ne l'implémente pas.
  repo.applyGain = undefined;
  assert.equal(typeof repo.applyGain, "undefined");

  const svc = new XPService({ repository: repo });
  const config = { xp_enabled: true, xp_per_message: 15, xp_cooldown: 0 };
  const first = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });
  const second = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });

  assert.equal(first.xp, 15);
  assert.equal(second.xp, 30);
  assert.equal((await repo.findOne("g", "u")).xp, 30);
});

test("B3 — un gain nul n'arme pas la garde locale de cooldown", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo, clock: () => 0 });

  const res = await svc.handleMessage({
    guildId: "g", userId: "u", isBot: false,
    config: { xp_enabled: true, xp_per_message: 0, xp_cooldown: 60 },
  });

  assert.equal(res.xpGain, 0);
  assert.equal(svc.cooldowns.size, 0,
    "un gain nul ne doit pas armer la garde locale : il bloquerait un gain réel");
});

test("B3 — un gain nul suivi d'un gain réel n'est pas refusé (bout en bout)", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo, clock: () => 0 });

  const zero = await svc.handleMessage({
    guildId: "g", userId: "u", isBot: false,
    config: { xp_enabled: true, xp_per_message: 0, xp_cooldown: 60 },
  });
  assert.equal(zero.xpGain, 0);

  // Défaut mesuré avant correction : ce message partait en XP_COOLDOWN alors
  // qu'aucun XP n'avait jamais été accordé.
  const real = await svc.handleMessage({
    guildId: "g", userId: "u", isBot: false,
    config: { xp_enabled: true, xp_per_message: 15, xp_cooldown: 60 },
  });
  assert.equal(real.code, "XP_GAINED");
  assert.equal(real.xpGain, 15);
  assert.equal(real.xp, 15);
});

test("B3 — applyGain InMemory : un gain nul ne pose pas d'horodatage", async () => {
  const repo = new InMemoryXPRepository({ clock: () => 0 });
  const levelFor = (xp) => new LevelService().levelForXp(xp);

  await repo.applyGain({ guildId: "g", userId: "u", gain: 0, cooldownSeconds: 60, computeLevel: levelFor, now: 0 });
  assert.equal((await repo.findOne("g", "u")).lastXpAt, null,
    "le repli InMemory doit appliquer la même règle que Supabase");

  const real = await repo.applyGain({ guildId: "g", userId: "u", gain: 15, cooldownSeconds: 60, computeLevel: levelFor, now: 1000 });
  assert.equal(real.applied, true);
  assert.equal(real.xp, 15);
});
