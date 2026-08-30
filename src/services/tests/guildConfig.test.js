"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ErrorCode,
  BackendUnavailableError,
  PersistenceError,
  ValidationError,
} = require("../../core/errors");
const { LegacyGuildConfigRepository } = require("../../core/guild-config/LegacyGuildConfigRepository");
const { GuildConfigResolver } = require("../../core/guild-config/GuildConfigResolver");
const service = require("../guildConfig");

function fakeClient({ read = { data: null, error: null }, write = null, all = { data: [], error: null } } = {}) {
  const calls = [];
  const client = {
    from(table) {
      const call = { table, operation: "read", payload: null, options: null, guildId: null };
      calls.push(call);
      const builder = {
        select() { return this; },
        eq(_column, value) { call.guildId = value; return this; },
        upsert(payload, options) {
          call.operation = "write";
          call.payload = payload;
          call.options = options;
          return this;
        },
        async maybeSingle() {
          return call.operation === "write" ? (write || { data: null, error: null }) : read;
        },
        then(resolve, reject) {
          return Promise.resolve(all).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

function useDatabase(client) {
  service._setDatabaseProvider(() => ({
    supabase: client,
    supabaseAdmin: client,
    databaseState: { status: client ? "READY" : "NOT_CONFIGURED" },
  }));
}

test.afterEach(async () => {
  await service.invalidateCache();
  service._setDatabaseProvider();
});

test("offline reads expose backend unavailability and offline writes never succeed in memory", async () => {
  useDatabase(null);

  assert.deepEqual(await service.getGuildConfigState("guild-1"), {
    config: {},
    available: false,
    found: false,
    source: "unavailable",
    reason: ErrorCode.BACKEND_UNAVAILABLE,
  });
  assert.deepEqual(await service.getGuildConfig("guild-1"), {});

  await assert.rejects(
    () => service.updateGuildConfig("guild-1", { language: "fr" }),
    (error) => error instanceof BackendUnavailableError && error.code === ErrorCode.BACKEND_UNAVAILABLE
  );
  assert.equal(service._getCache().has("guild-1"), false);
});

test("successful reads are cached with an explicit available state", async () => {
  const { client, calls } = fakeClient({ read: { data: { guild_id: "guild-1", language: "en" }, error: null } });
  useDatabase(client);

  assert.deepEqual(await service.getGuildConfigState("guild-1"), {
    config: { guild_id: "guild-1", language: "en" },
    available: true,
    found: true,
    source: "database",
    reason: null,
  });
  const cached = await service.getGuildConfigState("guild-1");
  assert.equal(cached.source, "cache");
  assert.equal(calls.length, 1);
});

test("a successful empty read is distinct from backend unavailability", async () => {
  const { client } = fakeClient({ read: { data: null, error: null } });
  useDatabase(client);
  assert.deepEqual(await service.getGuildConfigState("missing"), {
    config: {},
    available: true,
    found: false,
    source: "database",
    reason: null,
  });
});

test("an expired cache is returned only as stale when the backend is unavailable", async () => {
  service._setCache("guild-2", { language: "fr" }, Date.now() - 1, true);
  useDatabase(null);

  assert.deepEqual(await service.getGuildConfigState("guild-2"), {
    config: { language: "fr" },
    available: false,
    found: true,
    source: "stale-cache",
    reason: ErrorCode.BACKEND_UNAVAILABLE,
  });
});

test("read failures expose their classified reason without returning false defaults", async () => {
  const { client } = fakeClient({ read: { data: null, error: { code: "42703", message: "private backend detail" } } });
  useDatabase(client);

  const state = await service.getGuildConfigState("guild-3");
  assert.equal(state.available, false);
  assert.equal(state.found, false);
  assert.equal(state.source, "unavailable");
  assert.equal(state.reason, "SCHEMA_MISMATCH");
});

test("a write succeeds only with a confirmed persisted row", async () => {
  const persisted = { guild_id: "guild-4", language: "en", tickets_enabled: false };
  const { client, calls } = fakeClient({ write: { data: persisted, error: null } });
  useDatabase(client);

  assert.deepEqual(await service.updateGuildConfig("guild-4", { language: "en", tickets_enabled: false }), persisted);
  assert.equal(calls[0].operation, "write");
  assert.equal(calls[0].payload.guild_id, "guild-4");
  assert.equal(calls[0].payload.tickets_enabled, false);
  assert.equal(calls[0].options.onConflict, "guild_id");
  assert.equal((await service.getGuildConfigState("guild-4")).source, "cache");
});

test("a write response without a row is an explicit persistence failure", async () => {
  const { client } = fakeClient({ write: { data: null, error: null } });
  useDatabase(client);

  await assert.rejects(
    () => service.updateGuildConfig("guild-5", { language: "fr" }),
    (error) => error instanceof PersistenceError && error.code === ErrorCode.PERSISTENCE_FAILED
  );
  assert.equal(service._getCache().has("guild-5"), false);
});

test("write errors retain distinct schema, permission, conflict and backend codes", async (t) => {
  const cases = [
    ["schema", { code: "42P01" }, ErrorCode.PERSISTENCE_SCHEMA_MISMATCH],
    ["permission", { code: "42501", status: 403 }, ErrorCode.PERSISTENCE_PERMISSION_DENIED],
    ["conflict", { code: "23505", status: 409 }, ErrorCode.PERSISTENCE_CONFLICT],
    ["network", { code: "ECONNRESET" }, ErrorCode.BACKEND_UNAVAILABLE],
  ];

  for (const [name, backendError, expectedCode] of cases) {
    await t.test(name, async () => {
      const { client } = fakeClient({ write: { data: null, error: backendError } });
      useDatabase(client);
      await assert.rejects(
        () => service.updateGuildConfig(`guild-${name}`, { language: "fr" }),
        (error) => error.code === expectedCode
      );
      await service.invalidateCache();
    });
  }
});

test("invalid updates fail before consulting the database", async () => {
  let providerCalls = 0;
  service._setDatabaseProvider(() => { providerCalls += 1; return {}; });

  await assert.rejects(() => service.updateGuildConfig("", { language: "fr" }), ValidationError);
  await assert.rejects(() => service.updateGuildConfig("guild", {}), ValidationError);
  await assert.rejects(() => service.updateGuildConfig("guild", { language: undefined }), ValidationError);
  await assert.rejects(() => service.updateGuildConfig("guild", { guild_id: "other" }), ValidationError);
  assert.equal(providerCalls, 0);
});

test("LegacyGuildConfigRepository and resolver propagate backend state without a second source", async () => {
  useDatabase(null);
  const repository = new LegacyGuildConfigRepository({
    getConfig: service.getGuildConfig,
    updateConfig: service.updateGuildConfig,
    invalidate: service.invalidateCache,
  });
  const resolver = new GuildConfigResolver({ repository });

  const state = await resolver.getState("guild-6");
  assert.equal(state.available, false);
  assert.equal(state.found, false);
  assert.deepEqual(await resolver.get("guild-6"), {});
});

test("getAllGuildConfigs is fail-closed and returns only confirmed arrays", async () => {
  useDatabase(null);
  await assert.rejects(() => service.getAllGuildConfigs(), BackendUnavailableError);

  const { client } = fakeClient({ all: { data: [{ guild_id: "a" }, { guild_id: "b" }], error: null } });
  useDatabase(client);
  assert.deepEqual(await service.getAllGuildConfigs(), [{ guild_id: "a" }, { guild_id: "b" }]);
});
