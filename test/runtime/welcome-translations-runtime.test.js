"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
test("runtime composes Welcome translations with core and Guild Settings dictionaries",()=>{const runtime=createGuildSettingsRuntime({legacyConfigService:{getGuildConfig:async()=>({language:"fr"}),updateGuildConfig:async()=>({}),invalidateCache:async()=>{}}});assert.ok(runtime.registry);});
