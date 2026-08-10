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
