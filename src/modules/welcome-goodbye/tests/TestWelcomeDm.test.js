"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { testWelcomeDm } = require("../interactions/testWelcomeDm");
test("test Welcome DM sends configured message", async () => {
  const sent = [];
  await testWelcomeDm({ guildId:"g", t:(key)=>key, settings:{ get:async()=>({welcome_dm_enabled:true,welcome_dm_message:"Hi"}) }, envelope:{ transport:{ sendTestWelcomeDm:async(value)=>sent.push(value), reply:async()=>{} } } });
  assert.equal(sent[0].content,"Hi");
});
