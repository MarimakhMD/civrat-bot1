"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("database module loads offline without credentials and exports null supabase", () => {
  const mod = require("../database");
  assert.ok("supabase" in mod);
  assert.ok("supabaseAdmin" in mod);
  // Offline (no SUPABASE_URL) → null
  assert.equal(mod.supabase, null);
  assert.equal(mod.supabaseAdmin, null);
});

test("database module does not throw when required", () => {
  assert.doesNotThrow(() => require("../database"));
});

test("database exports are either null or Supabase client", () => {
  const { supabase } = require("../database");
  if (supabase !== null) {
    assert.equal(typeof supabase.from, "function");
  } else {
    assert.equal(supabase, null);
  }
});
