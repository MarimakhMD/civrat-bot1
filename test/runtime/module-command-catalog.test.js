"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const commandHandler = require("../../src/handlers/commandHandler");
const {
  EXPECTED_GLOBAL_COMMAND_NAMES,
  prepareDeploymentPlan,
} = require("../../deploy");

test("runtime command catalog is exactly 22 global commands plus technical /admin", () => {
  const loaded = commandHandler.loadCommands();
  const plan = prepareDeploymentPlan(loaded);
  assert.deepEqual(plan.global.map(({ name }) => name).sort(), [...EXPECTED_GLOBAL_COMMAND_NAMES].sort());
  assert.deepEqual(plan.technical.map(({ name }) => name), ["admin"]);
  assert.equal(loaded.size, 23);
  assert.equal(loaded.has("ownerpanel"), false);
  assert.equal(loaded.has("recovery"), false);
});
