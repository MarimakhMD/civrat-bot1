"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchAuditLog, _clearCache, _getCache } = require("../auditLogCache");

test("fetchAuditLog returns null for missing guild", async () => {
  assert.equal(await fetchAuditLog(null, 20), null);
  assert.equal(await fetchAuditLog({ id: null }, 20), null);
});

test("fetchAuditLog caches and respects TTL", async () => {
  _clearCache();
  let calls = 0;
  const entry = { target: { id: "123" } };
  const guild = {
    id: "g1",
    fetchAuditLogs: async () => {
      calls++;
      return { entries: { first: () => entry } };
    },
  };
  const first = await fetchAuditLog(guild, 20);
  assert.equal(first, entry);
  assert.equal(calls, 1);
  const second = await fetchAuditLog(guild, 20);
  assert.equal(second, entry);
  assert.equal(calls, 1); // cached
  assert.equal(_getCache().size, 1);
  _clearCache();
  const third = await fetchAuditLog(guild, 20);
  assert.equal(third, entry);
  assert.equal(calls, 2);
});

test("fetchAuditLog handles fetch errors gracefully", async () => {
  _clearCache();
  const guild = {
    id: "g2",
    fetchAuditLogs: async () => { throw new Error("rate limited"); },
  };
  const result = await fetchAuditLog(guild, 20);
  assert.equal(result, null);
});

test("fetchAuditLog returns null when no entry", async () => {
  _clearCache();
  const guild = {
    id: "g3",
    fetchAuditLogs: async () => ({ entries: { first: () => null } }),
  };
  const result = await fetchAuditLog(guild, 20);
  assert.equal(result, null);
});
