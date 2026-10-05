"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CaptchaSessionStore, CaptchaSessionState } = require("../services/CaptchaSessionStore");

test("create/get roundtrip with injectable clock", () => {
  let now = 1000;
  const store = new CaptchaSessionStore({ clock: () => now });
  const session = store.create("g1", "m1", { expiresAt: 1000 + 300000 });
  assert.equal(session.state, CaptchaSessionState.PENDING);
  assert.equal(session.createdAt, 1000);
  assert.equal(session.attempts, 0);
  assert.equal(store.get("g1", "m1"), session);
  now = 4242;
  assert.equal(store.get("g1", "m1").createdAt, 1000, "les sessions ne suivent pas le clock");
});

test("isolation by guild AND member (strict keys)", () => {
  const store = new CaptchaSessionStore();
  store.create("g1", "m1", { expiresAt: 1 });
  store.create("g2", "m1", { expiresAt: 2 });
  store.create("g1", "m2", { expiresAt: 3 });
  assert.equal(store.size, 3);
  assert.equal(store.get("g1", "m1").expiresAt, 1);
  assert.equal(store.get("g2", "m1").expiresAt, 2);
  assert.equal(store.get("g1", "m2").expiresAt, 3);
  store.delete("g1", "m1");
  assert.equal(store.get("g1", "m1"), undefined);
  assert.ok(store.get("g2", "m1"), "l'isolation des guildes ne doit pas casser");
  assert.ok(store.get("g1", "m2"), "l'isolation des membres ne doit pas casser");
});

test("setState replaces the frozen entry (attempts persisted)", () => {
  const store = new CaptchaSessionStore();
  store.create("g1", "m1", { expiresAt: 1 });
  const next = store.setState("g1", "m1", { state: CaptchaSessionState.FAILED, attempts: 1, nextAttemptAt: 50 });
  assert.equal(next.state, CaptchaSessionState.FAILED);
  assert.equal(next.attempts, 1);
  assert.equal(store.get("g1", "m1").nextAttemptAt, 50);
  assert.equal(store.setState("g1", "unknown", { state: "X" }), null, "setState sur absente = null");
  assert.ok(Object.isFrozen(store.get("g1", "m1")), "sessions gelées");
});

test("lazy sweep drops terminal and fully-closed entries when over the cap", () => {
  const store = new CaptchaSessionStore({ maxKeys: 3 });
  store.create("g0", "m", { expiresAt: 9 });
  store.setState("g0", "m", { state: CaptchaSessionState.SUCCESS });
  store.create("g1", "m", { expiresAt: 9 });
  store.setState("g1", "m", { state: CaptchaSessionState.EXPIRED });
  store.create("g2", "m", { expiresAt: 9 });
  // Au-delà du plafond : création d'une 4e session → purge paresseuse.
  store.create("g3", "m", { expiresAt: 9 });
  assert.ok(store.get("g0", "m") === undefined, "SUCCESS purgé");
  assert.ok(store.get("g1", "m") === undefined, "EXPIRED purgé");
  assert.ok(store.get("g2", "m"));
  assert.ok(store.get("g3", "m"));
  assert.ok(store.size <= 3);
});

test("malformed identifiers are refused", () => {
  const store = new CaptchaSessionStore();
  assert.throws(() => store.create("", "m", { expiresAt: 1 }), TypeError);
  assert.throws(() => store.create("g", "", { expiresAt: 1 }), TypeError);
  assert.throws(() => new CaptchaSessionStore({ clock: 123 }), TypeError);
});
