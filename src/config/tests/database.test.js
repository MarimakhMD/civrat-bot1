"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  databaseState,
  DatabaseClientStatus,
  createDatabaseRuntime,
} = require("../database");

const endpoint = "https://database.invalid";
const serviceCredential = "private-service-marker";
const anonymousCredential = "private-anonymous-marker";

test("database module exports only a non-sensitive initialization state", () => {
  assert.equal(typeof databaseState.status, "string");
  assert.equal(typeof databaseState.configured, "boolean");
  assert.equal(typeof databaseState.clientAvailable, "boolean");
  const serialized = JSON.stringify(databaseState);
  assert.equal(serialized.includes(endpoint), false);
  assert.equal(serialized.includes(serviceCredential), false);
  assert.equal(serialized.includes(anonymousCredential), false);
});

test("database runtime is explicitly not configured without an endpoint or credential", () => {
  let calls = 0;
  const runtime = createDatabaseRuntime({ createClientImpl: () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(runtime.supabase, null);
  assert.equal(runtime.supabaseAdmin, null);
  assert.deepEqual(runtime.state, {
    status: DatabaseClientStatus.NOT_CONFIGURED,
    configured: false,
    clientAvailable: false,
    privileged: false,
    mode: "offline",
  });
});

test("database runtime identifies a service-role client without exposing its inputs", () => {
  const client = { from() {} };
  const calls = [];
  const runtime = createDatabaseRuntime({
    url: endpoint,
    serviceRoleKey: serviceCredential,
    anonKey: anonymousCredential,
    createClientImpl: (...args) => {
      calls.push(args);
      return client;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(runtime.supabase, client);
  assert.equal(runtime.supabaseAdmin, client);
  assert.deepEqual(runtime.state, {
    status: DatabaseClientStatus.READY,
    configured: true,
    clientAvailable: true,
    privileged: true,
    mode: "service_role",
  });
  const serialized = JSON.stringify(runtime.state);
  assert.equal(serialized.includes(endpoint), false);
  assert.equal(serialized.includes(serviceCredential), false);
});

test("database runtime keeps an anonymous client out of the admin export", () => {
  const client = { from() {} };
  const runtime = createDatabaseRuntime({
    url: endpoint,
    anonKey: anonymousCredential,
    createClientImpl: () => client,
  });
  assert.equal(runtime.supabase, client);
  assert.equal(runtime.supabaseAdmin, null);
  assert.equal(runtime.state.mode, "anon");
  assert.equal(runtime.state.privileged, false);
});

test("database runtime classifies missing library and initialization failure without details", () => {
  const unavailable = createDatabaseRuntime({
    url: endpoint,
    anonKey: anonymousCredential,
    createClientImpl: null,
  });
  assert.equal(unavailable.state.status, DatabaseClientStatus.CLIENT_LIBRARY_UNAVAILABLE);
  assert.equal(unavailable.state.clientAvailable, false);

  const failed = createDatabaseRuntime({
    url: endpoint,
    serviceRoleKey: serviceCredential,
    createClientImpl: () => { throw new Error("private initialization detail"); },
  });
  assert.equal(failed.state.status, DatabaseClientStatus.INITIALIZATION_FAILED);
  assert.equal(failed.state.clientAvailable, false);
  assert.equal(JSON.stringify(failed.state).includes("private initialization detail"), false);
});
