"use strict";
const test=require("node:test"),assert=require("node:assert/strict");const {createGuildSettingsRuntime}=require("../../src/runtime/createGuildSettingsRuntime");
test("Guild Settings runtime composes a command without concrete persistence",()=>{const service={getGuildConfig:async()=>({language:"fr"}),updateGuildConfig:async(_id,update)=>update,invalidateCache:async()=>{}};const runtime=createGuildSettingsRuntime({legacyConfigService:service});assert.equal(runtime.getDiscordCommands()[0].data.name,"settings");});
