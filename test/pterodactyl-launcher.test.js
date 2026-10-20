"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { launch } = require("../start");
const { maintenanceCli } = require("../src/deployment/maintenanceCli");
const clientId="111111111111111111", admin="222222222222222222", guild="333333333333333333";
const catalog={global:[{name:"settings"}],technical:[{name:"admin"}]};
function setup() {
 const calls=[], state=new Map();
 const rest={get:async route=>{calls.push(["GET",route]);return route.startsWith('/users/')?[{id:guild},{id:admin}]:state.get(route)||[];},put:async(route,{body})=>{calls.push(["PUT",route]);state.set(route,body);}};
 return {calls,state,rest,run:args=>maintenanceCli(args,{rest,config:{clientId,civratAdminGuildId:admin},catalog})};
}
for(const args of [["list","--global"],["clear","--all-guilds"],["deploy","--guild",guild],["deploy","--global","--all-guilds"]]) {
 test(`shell → start.js → secure CLI: ${args.join(' ')}`,()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'civrat-launch-'));
  try {
   // Replace only the node executable; the real shell, launcher and CLI execute.
   const executable=path.join(temp,'node');
   const modulePath=path.resolve(__dirname,'../start.js');
   const cliPath=path.resolve(__dirname,'../src/deployment/maintenanceCli.js');
   writeFileSync(executable,`#!${process.execPath}\nconst assert=require('node:assert/strict');\nconst args=process.argv.slice(3);assert.deepEqual(args,${JSON.stringify(args)});let puts=0;require(${JSON.stringify(modulePath)}).launch(args,{start:()=>{throw Error('bot must not start')},maintenance:argv=>require(${JSON.stringify(cliPath)}).maintenanceCli(argv,{rest:{get:async r=>r.startsWith('/users/')?[{id:'${guild}'}]:[],put:async()=>{puts++;}},config:{clientId:'${clientId}',civratAdminGuildId:'${admin}'},catalog:${JSON.stringify(catalog)}})}).then(r=>{assert.equal(r.ok,true);assert.equal(puts,0);console.log('SAFE_PREVIEW')}).catch(e=>{console.error(e);process.exitCode=1});`,{mode:0o755});
   const child=spawnSync('bash',['start.sh',...args],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PATH:temp+path.delimiter+process.env.PATH},encoding:'utf8'});
   assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/SAFE_PREVIEW/);
  } finally {rmSync(temp,{recursive:true,force:true});}
 });
}
test('all arguments preserved literally, no shell evaluation',()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'civrat-args-'));
 try {writeFileSync(path.join(temp,'node'),`#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(3)));`,{mode:0o755});
 const args=['clear','--guild',guild,'--confirm','$(touch NEVER); spaces *'];
 const r=spawnSync('bash',['start.sh',...args],{env:{...process.env,PATH:temp+path.delimiter+process.env.PATH},encoding:'utf8'});assert.equal(r.status,0);assert.deepEqual(JSON.parse(r.stdout),args);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('normal start loads only bot and rejects maintenance options',async()=>{let starts=0;await launch(['start'],{start:async()=>{starts++;},maintenance:()=>{throw Error('unexpected')}});assert.equal(starts,1);await assert.rejects(()=>launch(['start','--apply']));});
test('maintenance failure sets exit 1 and never starts bot',async()=>{const old=process.exitCode;try{let starts=0;await launch(['deploy','--global'],{start:()=>{starts++;},maintenance:async()=>({ok:false})});assert.equal(process.exitCode,1);assert.equal(starts,0);}finally{process.exitCode=old;}});
test('confirmation missing invalid and stale never writes',async()=>{const s=setup();const args=['deploy','--global'];const p=await s.run(args);for(const hash of [null,'invalid']){const r=await s.run([...args,'--apply',...(hash?['--confirm',hash]:[])]);assert.equal(r.ok,false);}s.state.set(`/applications/${clientId}/commands`,[{name:'changed'}]);const r=await s.run([...args,'--apply','--confirm',p.confirmation]);assert.equal(r.ok,false);assert.equal(s.calls.some(c=>c[0]==='PUT'),false);});
test('confirmed deploy isolates scope and reports readback stages',async()=>{const s=setup();const args=['deploy','--guild',admin];const p=await s.run(args);const r=await s.run([...args,'--apply','--confirm',p.confirmation]);assert.equal(r.ok,true);assert.equal(r.scopes[0].role,'technical');assert.deepEqual(r.scopes[0].after,catalog.technical);assert.ok(s.calls.every(c=>c[1]===`/applications/${clientId}/guilds/${admin}/commands`));});
test('diagnostics distinguish write, readback and schema failures',async()=>{
 for(const stage of ['write','readback','schema']) {
  const s=setup(),args=['deploy','--global'];const p=await s.run(args);const get=s.rest.get;let written=false;
  s.rest.put=async()=>{if(stage==='write')throw {status:403,code:50001};written=true;};
  s.rest.get=async route=>{if(written){if(stage==='readback')throw {code:'ECONNRESET'};return [{name:'wrong'}];}return get(route);};
  const r=await s.run([...args,'--apply','--confirm',p.confirmation]);assert.equal(r.ok,false);assert.equal(r.scopes[0].error.stage,stage);
 }
});
test('missing guild id rejected without network calls',async()=>{const s=setup();await assert.rejects(()=>s.run(['clear','--guild']));assert.deepEqual(s.calls,[]);});
test('maintenance run propagates rejection as exit code 1 without bot startup',async()=>{const old=process.exitCode;try {const r=await require('../start').run(['clear','--global'],{maintenance:async()=>{throw Error('offline failure');},start:()=>{throw Error('must not start');}});assert.equal(r.ok,false);assert.equal(process.exitCode,1);}finally{process.exitCode=old;}});
for(const target of ['--global','--all-guilds']) {
 test(`Pterodactyl edited MODE with empty GUILD_ID supports ${target}`,()=>{
  const fs=require('node:fs'), temp=mkdtempSync(path.join(tmpdir(),'civrat-config-'));
  try {
   const script=fs.readFileSync(path.resolve(__dirname,'../start.sh'),'utf8').replace('MODE="start"','MODE="clear"').replace('MAINTENANCE_ARGS=()','MAINTENANCE_ARGS=('+target+')');
   writeFileSync(path.join(temp,'start.sh'),script);
   writeFileSync(path.join(temp,'node'),`#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(3)));`,{mode:0o755});
   const r=spawnSync('bash',[path.join(temp,'start.sh')],{env:{...process.env,PATH:temp+path.delimiter+process.env.PATH},encoding:'utf8'});
   assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),['clear',target]);
  }finally{rmSync(temp,{recursive:true,force:true});}
 });
}
test('Bash exec preserves maintenance exit status',()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'civrat-exit-'));
 try {writeFileSync(path.join(temp,'node'),'#!/usr/bin/env bash\nexit 1\n',{mode:0o755});const r=spawnSync('bash',['start.sh','clear','--global'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PATH:temp+path.delimiter+process.env.PATH}});assert.equal(r.status,1);}
 finally{rmSync(temp,{recursive:true,force:true});}
});
