"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const {WelcomeAdminAction,WelcomeAdminLogService}=require("../services/WelcomeAdminLogService");
test("administrative welcome actions produce structured events",()=>{const events=[];const service=new WelcomeAdminLogService({logger:{info:(_m,e)=>events.push(e)}});service.record({action:WelcomeAdminAction.ENABLED,guildId:"g",actorId:"u"});assert.equal(events[0].action,WelcomeAdminAction.ENABLED);});
