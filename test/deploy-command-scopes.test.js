"use strict";

// Fixed, unmistakably non-production values. They are set before deploy.js is
// loaded so every REST operation below uses an injected in-memory double.
process.env.DISCORD_TOKEN = "offline-test-token-not-a-secret";
process.env.CLIENT_ID = "111111111111111111";
process.env.CIVRAT_ADMIN_GUILD_ID = "1320817768962064384";
process.env.LEGACY_GUILD_ID = "1234567890123456789";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { Routes } = require("discord.js");
const {
  EXPECTED_GLOBAL_COMMAND_NAMES,
  prepareDeploymentPlan,
  validateDeploymentPlan,
  deployCommands,
  clearGuildCommands,
  listCommands,
  parseCliArgs,
} = require("../deploy");
const { config } = require("../src/config");
const { CommandDeploymentScope } = require("../src/core/interactions");

const NORMAL_GUILD_ID = "222222222222222222";
const TECHNICAL_GUILD_ID = "1320817768962064384";
const FORBIDDEN_COMMANDS = new Set(["admin", "ownerpanel", "recovery"]);

function command(name, deploymentScope = undefined) {
  return {
    deploymentScope,
    data: { toJSON: () => ({ name, description: `${name} command` }) },
  };
}

function validCommands() {
  return new Map([
    ...EXPECTED_GLOBAL_COMMAND_NAMES.map((name) => [name, command(name)]),
    ["admin", command("admin", CommandDeploymentScope.CIVRAT_ADMIN_GUILD)],
  ]);
}

function createRestDouble(seed = []) {
  const calls = [];
  const state = new Map(seed);
  return {
    calls,
    async put(route, { body }) {
      calls.push({ method: "PUT", route, body });
      state.set(route, body);
      return body;
    },
    async get(route) {
      calls.push({ method: "GET", route });
      return state.get(route) || [];
    },
  };
}

function putCalls(rest) {
  return rest.calls.filter(({ method }) => method === "PUT");
}

function getCalls(rest) {
  return rest.calls.filter(({ method }) => method === "GET");
}

function names(body) {
  return body.map(({ name }) => name);
}

function assertNoObsoleteCommands(body) {
  assert.equal(body.some(({ name }) => name === "ownerpanel" || name === "recovery"), false);
}

function assertNormalCatalog(body) {
  assert.deepEqual(names(body), EXPECTED_GLOBAL_COMMAND_NAMES);
  assert.equal(body.some(({ name }) => FORBIDDEN_COMMANDS.has(name)), false);
}

test("deployment plan contains exactly 22 global commands and technical /admin", () => {
  const plan = prepareDeploymentPlan(validCommands());
  assertNormalCatalog(plan.global);
  assert.deepEqual(names(plan.technical), ["admin"]);
  assertNoObsoleteCommands(plan.technical);
  assert.deepEqual(validateDeploymentPlan(plan), []);
});

test("production deploy without an id performs 22 global + technical /admin", async () => {
  const rest = createRestDouble();
  const result = await deployCommands({ commands: validCommands(), rest });
  const puts = putCalls(rest);

  assert.equal(result.ok, true);
  assert.equal(result.mode, "production");
  assert.equal(result.sent, 23);
  assert.equal(puts.length, 2);
  assert.equal(puts[0].route, Routes.applicationCommands(config.clientId));
  assertNormalCatalog(puts[0].body);
  assert.equal(puts[1].route, Routes.applicationGuildCommands(config.clientId, TECHNICAL_GUILD_ID));
  assert.deepEqual(names(puts[1].body), ["admin"]);
  assertNoObsoleteCommands(puts[0].body);
  assertNoObsoleteCommands(puts[1].body);
});

test("targeted normal guild deploy performs one Guild PUT with only 22 normal commands", async () => {
  const rest = createRestDouble();
  const result = await deployCommands({
    commands: validCommands(),
    rest,
    guildId: NORMAL_GUILD_ID,
  });
  const puts = putCalls(rest);

  assert.equal(result.ok, true);
  assert.equal(result.mode, "guild");
  assert.equal(result.scope, "normal");
  assert.equal(result.sent, 22);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].route, Routes.applicationGuildCommands(config.clientId, NORMAL_GUILD_ID));
  assert.notEqual(puts[0].route, Routes.applicationCommands(config.clientId));
  assertNormalCatalog(puts[0].body);
  assertNoObsoleteCommands(puts[0].body);
});

test("targeted technical guild deploy performs one Guild PUT with only /admin", async () => {
  const rest = createRestDouble();
  const result = await deployCommands({
    commands: validCommands(),
    rest,
    guildId: TECHNICAL_GUILD_ID,
  });
  const puts = putCalls(rest);

  assert.equal(result.ok, true);
  assert.equal(result.mode, "guild");
  assert.equal(result.scope, "technical");
  assert.equal(result.sent, 1);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].route, Routes.applicationGuildCommands(config.clientId, TECHNICAL_GUILD_ID));
  assert.notEqual(puts[0].route, Routes.applicationCommands(config.clientId));
  assert.deepEqual(names(puts[0].body), ["admin"]);
  assertNoObsoleteCommands(puts[0].body);
});

test("an explicit invalid deployment id is fail-closed with zero REST calls", async () => {
  const rest = createRestDouble();
  const result = await deployCommands({
    commands: validCommands(),
    rest,
    guildId: "not-a-discord-id",
  });

  assert.equal(result.ok, false);
  assert.equal(result.sent, 0);
  assert.deepEqual(rest.calls, []);
  assert.deepEqual(parseCliArgs(["deploy"]), {
    mode: "deploy",
    guildId: null,
    targetProvided: false,
  });
  assert.equal(parseCliArgs(["deploy", "invalid"]).invalidGuildId, true);
  assert.equal(parseCliArgs(["deploy", NORMAL_GUILD_ID]).invalidGuildId, false);
});

test("start.js rejects an invalid deploy target but still starts the bot", () => {
  const startPath = path.resolve(__dirname, "../start.js");
  const script = `
    const Module = require("node:module");
    const startPath = ${JSON.stringify(path.resolve(__dirname, "../start.js"))};
    const originalLoad = Module._load;
    let deployCalls = 0;
    let startCalls = 0;
    Module._load = function(request, parent, isMain) {
      if (parent && parent.filename === startPath && request === "./deploy") {
        return {
          deployCommands: async () => { deployCalls += 1; return { ok: true, registered: 0 }; },
          clearGuildCommands: async () => ({ ok: true, cleared: 0 }),
          listCommands: async () => ({ ok: true, commands: [] }),
          isSnowflake: (value) => typeof value === "string" && /^\\d{15,21}$/.test(value),
        };
      }
      if (parent && parent.filename === startPath && request === "./index") {
        return { main: async () => { startCalls += 1; } };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    process.argv = [process.execPath, startPath, "deploy", "invalid"];
    require(startPath);
    process.on("beforeExit", () => {
      console.log("START_RESULT=" + JSON.stringify({ deployCalls, startCalls }));
    });
  `;
  const child = spawnSync(process.execPath, ["-e", script], {
    cwd: path.dirname(startPath),
    encoding: "utf8",
  });

  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /No Discord request made/);
  assert.match(child.stdout, /START_RESULT=\{"deployCalls":0,"startCalls":1\}/);
});

test("start.js sends fatal errors through the sanitized logger", () => {
  const startPath = path.resolve(__dirname, "../start.js");
  const sensitiveMarker = ["must", "not", "escape", "fatal", "path"].join("-");
  const script = `
    const Module = require("node:module");
    const startPath = ${JSON.stringify(path.resolve(__dirname, "../start.js"))};
    const marker = ${JSON.stringify(sensitiveMarker)};
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (parent && parent.filename === startPath && request === "./deploy") {
        return {
          deployCommands: async () => ({ ok: true, registered: 0 }),
          clearGuildCommands: async () => ({ ok: true, cleared: 0 }),
          listCommands: async () => ({ ok: true, commands: [] }),
          isSnowflake: (value) => typeof value === "string" && /^\\d{15,21}$/.test(value),
        };
      }
      if (parent && parent.filename === startPath && request === "./index") {
        return {
          main: async () => {
            const uri = ["mongodb://", "startup-user", ":", marker, "@database.example/civrat"].join("");
            throw new Error("startup backend failed at " + uri);
          },
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    process.argv = [process.execPath, startPath, "start"];
    require(startPath);
  `;
  const child = spawnSync(process.execPath, ["-e", script], {
    cwd: path.dirname(startPath),
    encoding: "utf8",
  });

  assert.equal(child.status, 1);
  assert.match(child.stderr, /\[ERROR\] Fatal startup failure\./);
  assert.match(child.stderr, /mongodb:\/\/\[REDACTED\]@database\.example\/civrat/);
  assert.equal(child.stderr.includes(sensitiveMarker), false);
  assert.equal(child.stderr.includes("startup-user"), false);
  assert.equal(child.stderr.includes("[object Object]"), false);
});

test("clear removes only the requested Guild scope and never the global scope", async () => {
  const guildRoute = Routes.applicationGuildCommands(config.clientId, NORMAL_GUILD_ID);
  const globalRoute = Routes.applicationCommands(config.clientId);
  const rest = createRestDouble([[guildRoute, [{ name: "old" }, { name: "recovery" }]]]);
  const result = await clearGuildCommands({ rest, guildId: NORMAL_GUILD_ID });
  const puts = putCalls(rest);

  assert.equal(result.ok, true);
  assert.equal(result.cleared, 2);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].route, guildRoute);
  assert.notEqual(puts[0].route, globalRoute);
  assert.deepEqual(puts[0].body, []);
});

test("clear with an invalid id performs zero REST calls", async () => {
  const rest = createRestDouble();
  const result = await clearGuildCommands({ rest, guildId: "invalid" });
  assert.equal(result.ok, false);
  assert.deepEqual(rest.calls, []);
});

test("list and list <guildId> are read-only and select the requested scope", async () => {
  const globalRoute = Routes.applicationCommands(config.clientId);
  const guildRoute = Routes.applicationGuildCommands(config.clientId, NORMAL_GUILD_ID);
  const globalRest = createRestDouble([[globalRoute, [{ name: "analytics" }]]]);
  const guildRest = createRestDouble([[guildRoute, [{ name: "settings" }]]]);

  const globalResult = await listCommands({ rest: globalRest });
  const guildResult = await listCommands({ rest: guildRest, guildId: NORMAL_GUILD_ID });

  assert.equal(globalResult.ok, true);
  assert.deepEqual(names(globalResult.commands), ["analytics"]);
  assert.equal(guildResult.ok, true);
  assert.deepEqual(names(guildResult.commands), ["settings"]);
  assert.deepEqual(putCalls(globalRest), []);
  assert.deepEqual(putCalls(guildRest), []);
  assert.deepEqual(getCalls(globalRest).map(({ route }) => route), [globalRoute]);
  assert.deepEqual(getCalls(guildRest).map(({ route }) => route), [guildRoute]);
});

test("list with an invalid explicit id is fail-closed with zero REST calls", async () => {
  const rest = createRestDouble();
  const result = await listCommands({ rest, guildId: "invalid" });

  assert.equal(result.ok, false);
  assert.deepEqual(result.commands, []);
  assert.deepEqual(rest.calls, []);
  assert.equal(parseCliArgs(["list", "invalid"]).invalidGuildId, true);
});

test("deployment validation rejects command leakage between scopes", () => {
  const commands = validCommands();
  commands.set("ownerpanel", command("ownerpanel"));
  commands.set("admin", command("admin"));
  const plan = prepareDeploymentPlan(commands);
  assert.ok(validateDeploymentPlan(plan).length >= 2);
});

test("deployment plan rejects an unknown scope", () => {
  const commands = new Map([["bad", command("bad", "other-guild")]]);
  assert.throws(() => prepareDeploymentPlan(commands), /Unsupported command deployment scope/);
});
