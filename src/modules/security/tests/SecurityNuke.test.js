"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SecurityNukeService } = require("../services/SecurityNukeService");

test("nuke thresholds per spec: channelCreate 10, channelDelete 12, roleCreate 30, roleDelete 32", () => {
  const store = new Map();
  let now = 0;
  const svc = new SecurityNukeService({ store, clock: () => now });
  // channelCreate: 9 not nuke, 10 is nuke
  for (let i = 0; i < 9; i++) {
    assert.equal(svc.record({ guildId: "g1", action: "channelCreate" }).isNuke, false);
    now += 100;
  }
  assert.equal(svc.record({ guildId: "g1", action: "channelCreate" }).isNuke, true);
  // channelDelete: 11 not, 12 is
  now = 0;
  store.clear();
  for (let i = 0; i < 11; i++) {
    assert.equal(svc.record({ guildId: "g1", action: "channelDelete" }).isNuke, false);
    now += 100;
  }
  assert.equal(svc.record({ guildId: "g1", action: "channelDelete" }).isNuke, true);
  // roleCreate: 29 not, 30 is
  now = 0;
  store.clear();
  for (let i = 0; i < 29; i++) {
    svc.record({ guildId: "g1", action: "roleCreate" });
    now += 10;
  }
  assert.equal(svc.check({ guildId: "g1", action: "roleCreate" }).isNuke, false);
  assert.equal(svc.record({ guildId: "g1", action: "roleCreate" }).isNuke, true);
  // roleDelete: 31 not, 32 is
  now = 0;
  store.clear();
  for (let i = 0; i < 31; i++) {
    svc.record({ guildId: "g1", action: "roleDelete" });
    now += 10;
  }
  assert.equal(svc.check({ guildId: "g1", action: "roleDelete" }).isNuke, false);
  assert.equal(svc.record({ guildId: "g1", action: "roleDelete" }).isNuke, true);
});

test("nuke isolation per guild and per action", () => {
  const store = new Map();
  let now = 0;
  const svc = new SecurityNukeService({ store, clock: () => now });
  for (let i = 0; i < 10; i++) {
    svc.record({ guildId: "g1", action: "channelCreate" });
    now += 100;
  }
  assert.equal(svc.check({ guildId: "g1", action: "channelCreate" }).isNuke, true);
  assert.equal(svc.check({ guildId: "g1", action: "channelDelete" }).isNuke, false);
  assert.equal(svc.check({ guildId: "g2", action: "channelCreate" }).isNuke, false);
  assert.equal(svc.record({ guildId: "g2", action: "channelCreate" }).count, 1);
});

test("nuke window expiration clears history", () => {
  const store = new Map();
  let now = 0;
  const svc = new SecurityNukeService({ store, clock: () => now, windowMs: 15000 });
  for (let i = 0; i < 5; i++) {
    svc.record({ guildId: "g1", action: "channelCreate" });
    now += 1000;
  }
  assert.equal(svc.check({ guildId: "g1", action: "channelCreate" }).count, 5);
  now += 20000;
  assert.equal(svc.check({ guildId: "g1", action: "channelCreate" }).count, 0);
  assert.equal(svc.check({ guildId: "g1", action: "channelCreate" }).isNuke, false);
});

test("nuke custom thresholds and window via injection", () => {
  const store = new Map();
  let now = 0;
  const svc = new SecurityNukeService({ store, clock: () => now, windowMs: 5000, thresholds: { channelCreate: 3 } });
  svc.record({ guildId: "g1", action: "channelCreate" });
  now += 1000;
  svc.record({ guildId: "g1", action: "channelCreate" });
  now += 1000;
  assert.equal(svc.check({ guildId: "g1", action: "channelCreate" }).isNuke, false);
  assert.equal(svc.record({ guildId: "g1", action: "channelCreate" }).isNuke, true);
  now += 6000;
  assert.equal(svc.check({ guildId: "g1", action: "channelCreate" }).count, 0);
});

test("nuke clear per guild", () => {
  const store = new Map();
  let now = 0;
  const svc = new SecurityNukeService({ store, clock: () => now });
  for (let i = 0; i < 5; i++) svc.record({ guildId: "g1", action: "channelCreate" });
  for (let i = 0; i < 5; i++) svc.record({ guildId: "g1", action: "roleCreate" });
  svc.clear("g1");
  assert.equal(svc.check({ guildId: "g1", action: "channelCreate" }).count, 0);
  assert.equal(svc.check({ guildId: "g1", action: "roleCreate" }).count, 0);
});

test("nuke handles unknown action gracefully", () => {
  const svc = new SecurityNukeService({ store: new Map() });
  assert.equal(svc.record({ guildId: "g1", action: "unknown" }).isNuke, false);
  assert.equal(svc.record({ guildId: null, action: "channelCreate" }).isNuke, false);
});
