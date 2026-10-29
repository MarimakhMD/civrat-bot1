"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { maintainCommands } = require("../src/deployment/commandMaintenance");
const { maintenanceCli } = require("../src/deployment/maintenanceCli");
const id = "123456789012345678", admin = "223456789012345678", guild = "323456789012345678";
function setup() {
  const calls = [], data = new Map();
  const rest = {
    get: async route => { calls.push(["GET",route]); return data.get(route) || []; },
    put: async (route,{body}) => { calls.push(["PUT",route]); assert.match(route,/^\/applications\/\d+\/(commands|guilds\/\d+\/commands)$/); data.set(route,body); },
  };
  return { calls, data, rest, options: { rest, clientId:id, adminGuildId:admin, action:"deploy", targets:{global:true,guildIds:[guild,admin]}, catalog:{global:[{name:"supprimer",description:"purge"}],technical:[{name:"admin",description:"admin"}]} } };
}
test("preview then confirmed reconciliation: global catalog, empty normal guild, technical admin",async()=>{
 const {calls,options,data}=setup();data.set(`/applications/${id}/commands`,[{name:"captcha"}]);
 const preview=await maintainCommands(options);assert.equal(preview.ok,true);assert.equal(calls.some(c=>c[0]==="PUT"),false);
 const applied=await maintainCommands({...options,apply:true,confirm:preview.confirmation});assert.equal(applied.ok,true);
 assert.deepEqual(applied.scopes.find(s=>s.guildId===guild).after,[]);
 assert.equal(applied.scopes.find(s=>s.guildId===admin).after[0].name,"admin");
 assert.equal(applied.scopes[0].after.some(c=>c.name==="captcha"),false);
});
test("clear all scopes including technical is preview-only without confirmation",async()=>{
 const {options,calls}=setup();const r=await maintainCommands({...options,action:"clear",apply:true});assert.equal(r.ok,false);assert.equal(calls.some(c=>c[0]==="PUT"),false);
});
test("confirmed clear only command endpoints",async()=>{
 const {options}=setup();options.action="clear";const p=await maintainCommands(options);const r=await maintainCommands({...options,apply:true,confirm:p.confirmation});assert.equal(r.ok,true);assert.ok(r.scopes.every(s=>s.after.length===0));
});
test("guild enumeration paginated using exact string snowflakes",async()=>{
 const {options,rest}=setup();const orig=rest.get;let pages=0;
 rest.get=async route=>{if(!route.startsWith('/users/'))return orig(route);pages++;return pages===1?Array.from({length:200},(_,i)=>({id:String(400000000000000000n+BigInt(i))})):[];};
 const r=await maintainCommands({...options,targets:{allGuilds:true}});assert.equal(pages,2);assert.equal(r.scopes.length,200);assert.equal(r.ok,true);
});
for(const code of [403,429,"ECONNRESET"]){
 test(`partial inventory ${code} blocks every write`,async()=>{const {options,rest,calls}=setup();rest.get=async()=>{throw {status:typeof code==="number"?code:null,code};};const r=await maintainCommands({...options,apply:true,confirm:"x"});assert.equal(r.ok,false);assert.equal(calls.some(c=>c[0]==="PUT"),false);});
}
test("discovery failure blocks mutation even when explicit global inventory succeeds",async()=>{
 const {options,rest,calls}=setup();const get=rest.get;rest.get=route=>{if(route.startsWith('/users/'))throw {status:403};return get(route);};const r=await maintainCommands({...options,targets:{global:true,allGuilds:true},apply:true});assert.equal(r.ok,false);assert.equal(r.discovery.ok,false);assert.equal(calls.some(c=>c[0]==="PUT"),false);
});
test("partial writes remain visible and remaining scopes are processed",async()=>{
 const {options,rest}=setup();const p=await maintainCommands(options);const put=rest.put;rest.put=(route,b)=>{if(route.endsWith(`/${admin}/commands`))throw {status:403};return put(route,b);};const r=await maintainCommands({...options,apply:true,confirm:p.confirmation});assert.equal(r.ok,false);assert.equal(r.scopes.filter(s=>s.ok).length,2);assert.equal(r.scopes.find(s=>s.guildId===admin).error.status,403);
});
test("readback mismatch and readback failure cannot succeed",async()=>{
 for(const fail of [false,true]){const {options,rest}=setup();options.targets={global:true};const p=await maintainCommands(options);let wrote=false;rest.put=async()=>{wrote=true;};rest.get=async()=>{if(wrote&&fail)throw {status:500};return [];};const r=await maintainCommands({...options,apply:true,confirm:p.confirmation});assert.equal(r.ok,false);assert.equal(r.scopes[0].written,true);}
});
test("stale confirmation cannot overwrite a changed inventory",async()=>{const {options,data,calls}=setup();const p=await maintainCommands(options);data.set(`/applications/${id}/commands`,[{name:"changed"}]);const r=await maintainCommands({...options,apply:true,confirm:p.confirmation});assert.equal(r.ok,false);assert.equal(calls.some(c=>c[0]==="PUT"),false);});
test("invalid targets and admin escape rejected without calls",async()=>{const {options,calls}=setup();for(const patch of [{targets:{}},{targets:{guildIds:["bad"]}},{catalog:{global:[{name:"admin"}],technical:[{name:"admin"}]}}])await assert.rejects(()=>maintainCommands({...options,...patch}));assert.equal(calls.length,0);});
test("CLI rejects implicit targets, unknown flags, missing confirmation",async()=>{const {rest,options}=setup();for(const argv of [[],["clear"],["deploy","--force"],["clear","--global","--confirm"]])await assert.rejects(()=>maintenanceCli(argv,{rest,config:{clientId:id,civratAdminGuildId:admin},catalog:options.catalog}));});
