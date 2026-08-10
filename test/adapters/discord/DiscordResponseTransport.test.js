"use strict";
const test=require("node:test"),assert=require("node:assert/strict");const {payload}=require("../../../src/adapters/discord");
test("Discord response payload converts neutral views",()=>{const result=payload({title:"Title",content:"Content",components:[{type:"button",customId:"civrat:v1:x:y",label:"Open",style:"primary"}]},true);assert.equal(result.content,"Title\n\nContent");assert.equal(result.components.length,1);assert.equal(result.ephemeral,true);});
