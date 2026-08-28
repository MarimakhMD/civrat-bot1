"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const logger = require("../logger");

function captureLogs(callback) {
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts) => lines.push(parts.join(" "));
  console.error = (...parts) => lines.push(parts.join(" "));
  try {
    callback();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return lines.join("\n");
}

function privateMarker(label) {
  return ["must", "never", "appear", label].join("-");
}

function assertHidden(output, values) {
  for (const value of values) assert.equal(output.includes(value), false, `sensitive value leaked: ${value}`);
}

test("logger exposes every required level without throwing", () => {
  const output = captureLogs(() => {
    for (const level of ["debug", "info", "success", "warn", "error"]) {
      assert.equal(typeof logger[level], "function");
      assert.doesNotThrow(() => logger[level]("test message", { meta: 1 }));
      assert.doesNotThrow(() => logger[level]("test"));
    }
  });
  assert.match(output, /test message/);
});

test("sensitive keys are redacted recursively while safe diagnostics remain", () => {
  const token = privateMarker("token");
  const password = privateMarker("password");
  const masterCode = privateMarker("master");
  const recoveryCode = privateMarker("recovery");
  const apiKey = privateMarker("api-key");
  const serviceKey = privateMarker("service-key");
  const output = captureLogs(() => logger.info("admin diagnostic", {
    command: "admin",
    guildId: "1320817768962064384",
    status: 403,
    code: 50001,
    token,
    password,
    ownerPanelMasterCode: masterCode,
    nested: {
      recovery_code: recoveryCode,
      apiKey,
      supabaseServiceRoleKey: serviceKey,
    },
  }));

  assertHidden(output, [token, password, masterCode, recoveryCode, apiKey, serviceKey]);
  assert.match(output, /\[REDACTED\]/);
  assert.match(output, /"command":"admin"/);
  assert.match(output, /"guildId":"1320817768962064384"/);
  assert.match(output, /"status":403/);
  assert.match(output, /"code":50001/);
});

test("credentials and sensitive query parameters are removed from URIs", () => {
  const username = privateMarker("uri-user");
  const password = privateMarker("uri-password");
  const queryToken = privateMarker("query-token");
  const uri = ["mongodb://", username, ":", password, "@database.example/civrat?", "token", "=", queryToken, "&mode=safe"].join("");
  const output = captureLogs(() => logger.error(`connection failed: ${uri}`));

  assertHidden(output, [username, password, queryToken]);
  assert.match(output, /mongodb:\/\/\[REDACTED\]@database\.example\/civrat\?token=\[REDACTED\]&mode=safe/);
});

test("known token formats and authorization headers are redacted from messages", () => {
  const discord = ["A".repeat(24), "B".repeat(6), "C".repeat(27)].join(".");
  const mfa = `mfa.${"D".repeat(30)}`;
  const jwt = ["eyJ" + "E".repeat(16), "F".repeat(16), "G".repeat(16)].join(".");
  const github = `ghp_${"H".repeat(36)}`;
  const aws = `AKIA${"I".repeat(16)}`;
  const slack = `xoxb-${"J".repeat(24)}`;
  const stripe = `sk_live_${"K".repeat(24)}`;
  const genericApi = `sk-${"L".repeat(24)}`;
  const bearer = `Bearer ${"M".repeat(32)}`;
  const output = captureLogs(() => logger.warn([
    discord,
    mfa,
    jwt,
    github,
    aws,
    slack,
    stripe,
    genericApi,
    bearer,
  ].join(" ")));

  assertHidden(output, [discord, mfa, jwt, github, aws, slack, stripe, genericApi, "M".repeat(32)]);
  assert.match(output, /Bearer \[REDACTED\]/);
});

test("Owner, Recovery, password and API assignments are redacted in free-form text", () => {
  const owner = privateMarker("owner-code");
  const recovery = "123456";
  const password = privateMarker("free-password");
  const apiKey = privateMarker("free-api-key");
  const output = captureLogs(() => logger.info([
    `OWNER_PANEL_MASTER_CODE=${owner}`,
    `Recovery Code: ${recovery}`,
    `password=${password}`,
    `api_key=${apiKey}`,
  ].join("; ")));

  assertHidden(output, [owner, recovery, password, apiKey]);
  assert.match(output, /OWNER_PANEL_MASTER_CODE=\[REDACTED\]/);
  assert.match(output, /Recovery Code: \[REDACTED\]/);
});

test("Error objects retain safe diagnostics without leaking attached secrets", () => {
  const password = privateMarker("error-password");
  const uri = ["postgres://", "user", ":", password, "@database.example/civrat"].join("");
  const error = new Error(`backend unavailable at ${uri}`);
  error.code = "ECONNREFUSED";
  error.authorization = privateMarker("authorization");
  error.context = { guildId: "1320817768962064384", operation: "read" };

  const output = captureLogs(() => logger.error(error));

  assertHidden(output, [password, error.authorization]);
  assert.equal(output.includes("[object Object]"), false);
  assert.match(output, /"name":"Error"/);
  assert.match(output, /"message":"backend unavailable at postgres:\/\/\[REDACTED\]@database\.example\/civrat"/);
  assert.match(output, /"code":"ECONNREFUSED"/);
  assert.match(output, /"operation":"read"/);
});

test("objects and circular metadata are serialized safely", () => {
  const metadata = { event: "route_refused", durationMs: 17 };
  metadata.self = metadata;
  const message = { command: "admin", outcome: "refused" };

  const output = captureLogs(() => logger.info(message, metadata));

  assert.equal(output.includes("[object Object]"), false);
  assert.match(output, /\{"command":"admin","outcome":"refused"\}/);
  assert.match(output, /"durationMs":17/);
  assert.match(output, /"self":"\[Circular\]"/);
});

test("diagnostics explicitly allowed by policy are preserved", () => {
  const output = captureLogs(() => logger.info("command completed", {
    command: "settings",
    guildId: "1320817768962064384",
    userId: "222222222222222222",
    channelId: "1542957356382552154",
    errorType: "DiscordAPIError",
    httpStatus: 403,
    discordCode: 50001,
    endpoint: "PUT /applications/{clientId}/commands",
    durationMs: 42,
    success: false,
    commandCount: 23,
  }));

  for (const expected of [
    "settings",
    "1320817768962064384",
    "222222222222222222",
    "1542957356382552154",
    "DiscordAPIError",
    "403",
    "50001",
    "PUT /applications/{clientId}/commands",
    "42",
    "23",
  ]) {
    assert.match(output, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
