"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SecurityRaidService } = require("../services/SecurityRaidService");

test("raid not detected before 5 joins in 15s, detected at 5", () => {
  const store = new Map();
  let now = 0;
  const svc = new SecurityRaidService({ store, clock: () => now });
  for (let i = 0; i < 4; i++) {
    const res = svc.record("g1");
    assert.equal(res.isRaid, false);
    assert.equal(res.count, i + 1);
    now += 1000;
  }
  const fifth = svc.record("g1");
  assert.equal(fifth.isRaid, true);
  assert.equal(fifth.count, 5);
});

test("raid window expiration clears old joins", () => {
  const store = new Map();
  let now = 0;
  const svc = new SecurityRaidService({ store, clock: () => now, windowMs: 15000, threshold: 5 });
  for (let i = 0; i < 4; i++) {
    svc.record("g1");
    now += 1000;
  }
  assert.equal(svc.check("g1").isRaid, false);
  now += 20000; // beyond window
  // old joins expired, new count 0
  assert.equal(svc.check("g1").count, 0);
  assert.equal(svc.check("g1").isRaid, false);
  // new joins in fresh window
  for (let i = 0; i < 4; i++) {
    svc.record("g1");
    now += 100;
  }
  assert.equal(svc.check("g1").isRaid, false);
  assert.equal(svc.record("g1").isRaid, true);
});

test("raid isolation per guild and clear", () => {
  const store = new Map();
  let now = 0;
  const svc = new SecurityRaidService({ store, clock: () => now });
  for (let i = 0; i < 5; i++) {
    svc.record("g1");
    now += 100;
  }
  assert.equal(svc.check("g1").isRaid, true);
  assert.equal(svc.check("g2").isRaid, false);
  assert.equal(svc.record("g2").count, 1);
  svc.clear("g1");
  assert.equal(svc.check("g1").count, 0);
  assert.equal(svc.check("g1").isRaid, false);
});

test("raid custom threshold and window via injection", () => {
  const store = new Map();
  let now = 0;
  const svc = new SecurityRaidService({ store, clock: () => now, windowMs: 5000, threshold: 3 });
  svc.record("g1");
  now += 1000;
  svc.record("g1");
  now += 1000;
  assert.equal(svc.check("g1").isRaid, false);
  assert.equal(svc.record("g1").isRaid, true);
  now += 6000;
  assert.equal(svc.check("g1").count, 0);
});

test("raid handles missing guildId gracefully", () => {
  const svc = new SecurityRaidService({ store: new Map() });
  assert.equal(svc.record(null).isRaid, false);
  assert.equal(svc.record(undefined).count, 0);
  assert.equal(svc.check("").isRaid, false);
});

// ─────────────────────────────────────────────────────────────
// P-CAPT L5 — état raid exposé en LECTURE SEULE
// ─────────────────────────────────────────────────────────────

const { createSecurityRuntime } = require("../runtime/createSecurityRuntime");
const { SecurityRaidDefaults } = require("../configuration/securityConstants");

function raidRuntime({ config = {}, clock = null } = {}) {
  let now = 0;
  const raidService = new SecurityRaidService({
    store: new Map(),
    clock: clock || (() => now),
  });
  const runtime = createSecurityRuntime({
    configService: { read: async () => ({ security_enabled: true, security_anti_raid: true, ...config }) },
    raidService,
    logsRuntimeFactory: () => ({ disabled: true, handleModerationEvent: async () => {} }),
  });
  return { runtime, raidService, advance: (ms) => { now += ms; } };
}

const join = (guildId, userId) => ({ id: userId, guild: { id: guildId }, user: { bot: false } });

test("P-CAPT L5 — isRaidActive : peek en lecture seule, sans consommation ni écriture", async () => {
  const h = raidRuntime();
  assert.equal(h.runtime.isRaidActive("g1"), false, "aucune arrivée enregistrée");

  for (let i = 0; i < 5; i += 1) await h.runtime.handleMemberJoined(join("g1", `u${i}`));
  assert.equal(h.runtime.isRaidActive("g1"), true);

  // Peek pur : répéter la lecture n'enregistre aucune arrivée et ne change rien.
  const before = h.raidService.check("g1").count;
  for (let i = 0; i < 5; i += 1) h.runtime.isRaidActive("g1");
  assert.equal(h.raidService.check("g1").count, before, "aucune arrivée consommée par la lecture");
  assert.equal(h.runtime._raid.threshold, SecurityRaidDefaults.THRESHOLD, "seuil du moteur intact");
  assert.equal(h.runtime._raid.windowMs, SecurityRaidDefaults.WINDOW_MS, "fenêtre du moteur intacte");

  // Retour automatique : la fenêtre glissante retombe seule, sans écriture.
  h.advance(SecurityRaidDefaults.WINDOW_MS + 1000);
  assert.equal(h.runtime.isRaidActive("g1"), false);
  assert.equal(h.runtime.isRaidActive("g2"), false, "isolation par guilde");
  assert.equal(h.runtime.isRaidActive(null), false, "guilde absente ⇒ jamais de raid inventé");
});

test("P-CAPT L5 — sans security_anti_raid, aucun état raid n'est exposé", async () => {
  const h = raidRuntime({ config: { security_anti_raid: false } });
  for (let i = 0; i < 10; i += 1) await h.runtime.handleMemberJoined(join("g-off", `u${i}`));
  assert.equal(h.runtime.isRaidActive("g-off"), false, "activation strictement liée à security_anti_raid");
});

test("P-CAPT L5 — sécurité désactivée : aucun état raid malgré des arrivées en rafale", async () => {
  const h = raidRuntime({ config: { security_enabled: false } });
  for (let i = 0; i < 10; i += 1) await h.runtime.handleMemberJoined(join("g-disabled", `u${i}`));
  assert.equal(h.runtime.isRaidActive("g-disabled"), false);
});
