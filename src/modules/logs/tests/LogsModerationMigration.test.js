"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const {handleModerationEvent}=require("../events/handleModerationEvent");
test("moderation event delivers once when logs enabled",async()=>{let calls=0;const result=await handleModerationEvent({guild:{id:"g"},config:{logs_enabled:true,log_moderation_channel_id:"c"},action:"member_banned",targetId:"u",mapper:{map:x=>x},service:{resolveDestination:()=>"c"},delivery:{deliver:async()=>{calls+=1;return {delivered:true};}}});assert.equal(calls,1);assert.equal(result.delivered,true);});
