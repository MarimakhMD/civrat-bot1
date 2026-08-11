"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const logger = require("../logger");

test("logger exposes required levels without throwing", () => {
  for (const level of ["debug", "info", "success", "warn", "error"]) {
    assert.equal(typeof logger[level], "function");
    assert.doesNotThrow(() => logger[level]("test message", { meta: 1 }));
    assert.doesNotThrow(() => logger[level]("test"));
  }
});

test("logger handles non-string messages", () => {
  assert.doesNotThrow(() => logger.info({ foo: "bar" }));
  assert.doesNotThrow(() => logger.error(new Error("test")));
});
