"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const Module = require("node:module");
// Exercise the real event -> audit resolver -> logs runtime -> delivery ->
// renderer chain. Only EmbedBuilder is doubled; no SDK/network is installed.
class Embed {
  constructor() { this.data = {}; }
  setTitle(v) { this.data.title=v; return this; }
  setDescription(v) { this.data.description=v; return this; }
  setColor(v) { this.data.color=v; return this; }
  setThumbnail(v) { this.data.thumbnail=v; return this; }
  addFields(v) { this.data.fields=[...(this.data.fields||[]),...v]; return this; }
  setTimestamp() { this.data.timestamp="test"; return this; }
  toJSON() { return this.data; }
}
let createLogsRuntime, unrecognizedDetailKeys;
const originalLoad=Module._load;
try {
  Module._load=function(id,...args){return id==='discord.js'?{EmbedBuilder:Embed}:originalLoad.call(this,id,...args);};
  ({createLogsRuntime}=require('../runtime/createLogsRuntime'));
  ({unrecognizedDetailKeys}=require('../../../adapters/discord/DiscordLogsTransport'));
} finally { Module._load=originalLoad; }
const configService=require('../../../services/guildConfig');
const audit=require('../../../utils/auditLogActor');
const cache=require('../../../utils/auditLogCache');
const self=require('../../../utils/selfActionRegistry');
const logger=require('../../../utils/logger');
const {resolveLanguage}=require('../services/logLanguage');
const {localizeTitle}=require('../services/logTitles');
const {handleModerationEvent}=require('../events/handleModerationEvent');
const runtimePath=require.resolve('../runtime/getLogsRuntime'), previousRuntime=require.cache[runtimePath];
let current;
require.cache[runtimePath]={id:runtimePath,filename:runtimePath,loaded:true,exports:{getLogsRuntime:()=>{current.factories++;if(current.factoryError)throw current.factoryError;return current.runtime;}}};
const handler=require('../../../events/guildMemberUpdate');
const previous={get:configService.getGuildConfig,warn:logger.warn,info:logger.info};
configService.getGuildConfig=async()=>{current.configReads++;if(current.onConfig)current.onConfig();return current.config;};
logger.warn=(_message,data)=>current.diagnostics.push(data);
logger.info=(_message,data)=>current.diagnostics.push(data);
test.after(()=>{configService.getGuildConfig=previous.get;logger.warn=previous.warn;logger.info=previous.info;if(previousRuntime)require.cache[runtimePath]=previousRuntime;else delete require.cache[runtimePath];});
let sequence=0;
function harness(language='fr') {
  audit._resetConsumed();cache._clearCache();self._clearSelfActions();
  const f={calls:[],results:[],sent:[],diagnostics:[],auditReads:0,configReads:0,factories:0,sendAttempts:0,entries:[],config:{language,logs_enabled:true,log_moderation_channel_id:'logs'}};
  const guild={id:'lot4-'+(++sequence),channels:{cache:new Map()},fetchAuditLogs:async()=>{f.auditReads++;if(f.auditError)throw f.auditError;return {entries:new Map(f.entries.map(e=>[e.id,e]))};}};
  guild.channels.cache.set('logs',{isTextBased:()=>true,send:async payload=>{f.sendAttempts++;if(f.sendError)throw f.sendError;f.sent.push(payload.embeds[0].toJSON());}});
  const real=createLogsRuntime({guildConfigResolver:{get:async()=>f.config}});
  f.runtime={handleModerationEvent:async payload=>{f.calls.push(payload);const result=await real.handleModerationEvent(payload);f.results.push(result);return result;}};
  f.member=timeout=>({id:'u',guild,nickname:'Name',roles:{cache:new Map([['everyone',{}]])},user:{id:'u',tag:'User'},communicationDisabledUntilTimestamp:timeout});
  f.guild=guild;current=f;return f;
}
function entry(f,before,after,{id='audit',target='u',key='communication_disabled_until',executor='moderator'}={}) {
  return {id,action:24,target:{id:target},createdTimestamp:Date.now(),executor:{id:executor,tag:executor},reason:'Reason',changes:[{key,old:before===null?null:new Date(before).toISOString(),new:after===null?null:new Date(after).toISOString()}]};
}
for(const language of ['fr','en',' EN ','unsupported',undefined])for(const kind of ['extended','reduced'])test(`timeout ${kind}, language=${language}: one complete business log`,async()=>{
 const f=harness(language),now=Date.now(),before=now+600000,after=before+(kind==='extended'?300000:-300000);
 f.entries=[entry(f,before,after)];await handler.execute(f.member(before),f.member(after));
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,`member_timeout_${kind}`);assert.equal(f.calls[0].moderatorId,'moderator');assert.equal(f.calls[0].reason,'Reason');
 assert.equal(f.calls[0].before,`<t:${Math.floor(before/1000)}:F>`);assert.equal(f.calls[0].after,`<t:${Math.floor(after/1000)}:F>`);
 assert.equal(f.auditReads,1);assert.equal(f.sendAttempts,1);assert.equal(f.sent.length,1);assert.equal(f.results[0].delivered,true);
 const en=resolveLanguage(f.config)==='en',embed=f.sent[0];assert.equal(embed.title,localizeTitle(f.config,`logs.member_timeout_${kind}`));
 assert.ok(embed.fields.some(field=>field.name.includes(en?'Before':'Avant')));assert.ok(embed.fields.some(field=>field.name.includes(en?'After':'Après')));
 assert.ok(embed.fields.some(field=>field.value.includes('Reason')));assert.ok(embed.fields.some(field=>field.value.includes('moderator')));
 assert.equal(f.diagnostics.some(d=>d.reason==='LOG_DETAILS_UNMAPPED'),false);assert.doesNotMatch(JSON.stringify(embed),/{{\s*\w+\s*}}/);
});
test('fallback uses the same language for title and fields; unknown keys never leak',()=>{
 for(const [language,expected] of [['en','en'],['EN','en'],[' en ','en'],['fr','fr'],[' FR ','fr'],['de','fr'],['','fr'],[null,'fr'],[42,'fr']]){
  assert.equal(resolveLanguage({language}),expected);assert.equal(localizeTitle({language},'logs.member_timeout_extended'),localizeTitle({language:expected},'logs.member_timeout_extended'));
 }
 assert.equal(resolveLanguage(null),'fr');assert.equal(localizeTitle({language:'en'},'logs.no_such_key'),null);
});
test('audit correlation requires exact old/new deadlines, correct target and a timeout change',async()=>{
 const f=harness(),now=Date.now(),before=now+600000,after=now+900000;
 f.entries=[entry(f,before,after,{id:'other-target',target:'other'}),entry(f,before-1000,after,{id:'wrong-old'}),entry(f,before,after+1000,{id:'wrong-new'}),entry(f,before,after,{id:'nickname',key:'nick'}),entry(f,before,after,{id:'correct',executor:'right'})];
 await handler.execute(f.member(before),f.member(after));assert.equal(f.calls[0].moderatorId,'right');assert.equal(f.calls.length,1);
 assert.deepEqual([...audit._getConsumed().values()].flatMap(m=>[...m.keys()]),['correct']);
});
test('two opposite duration changes consume their own audit entry without replay or generic apply/remove logs',async()=>{
 const f=harness(),now=Date.now(),a=now+600000,b=now+900000,c=now+300000;
 f.entries=[entry(f,b,c,{id:'reduction',executor:'second'}),entry(f,a,b,{id:'extension',executor:'first'})];
 await handler.execute(f.member(a),f.member(b));await handler.execute(f.member(b),f.member(c));
 assert.deepEqual(f.calls.map(c=>[c.action,c.moderatorId]),[['member_timeout_extended','first'],['member_timeout_reduced','second']]);assert.equal(f.sent.length,2);assert.equal(f.auditReads,1);
});
for(const auditError of [null,{code:50013}])test(`missing/inaccessible audit (${auditError?.code}): log factual change with unknown actor`,async()=>{
 const f=harness('en'),now=Date.now();f.auditError=auditError;
 await handler.execute(f.member(now+300000),f.member(now+600000));
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].moderator,null);assert.equal(f.calls[0].moderatorId,null);assert.equal(f.calls[0].reason,null);assert.equal(f.sent.length,1);
 assert.ok(f.sent[0].fields.some(field=>field.value==='unknown'));
 assert.ok(f.diagnostics.some(d=>d.event==='LOG_TIMEOUT_UNRESOLVED'));
});
test('gateway snapshot survives later mutation before config resolves',async()=>{
 const f=harness(),now=Date.now(),before=now+300000,after=now+600000,old=f.member(before),live=f.member(after);
 f.onConfig=()=>{live.communicationDisabledUntilTimestamp=now+900000;};
 await handler.execute(old,live);assert.equal(f.calls.length,1);assert.equal(f.calls[0].after,`<t:${Math.floor(after/1000)}:F>`);
});
for(const transition of ['unchanged','partial','invalid'])test(`${transition} timeout state does not invent a duration-change log`,async()=>{
 const f=harness(),now=Date.now(),old=f.member(now+300000),next=f.member(now+600000);
 if(transition==='unchanged')next.communicationDisabledUntilTimestamp=old.communicationDisabledUntilTimestamp;
 if(transition==='partial')old.partial=true;
 if(transition==='invalid'){old.communicationDisabledUntilTimestamp=NaN;next.communicationDisabledUntilTimestamp=undefined;}
 await handler.execute(old,next);assert.equal(f.calls.length,0);assert.equal(f.auditReads,0);assert.equal(f.configReads,0);
});
test('AutoMod self-action marker suppresses the secondary extension log before reading audit',async()=>{
 const f=harness(),now=Date.now();self.markSelfAction('timeout',f.guild.id,'u');
 await handler.execute(f.member(now+300000),f.member(now+600000));assert.equal(f.calls.length,0);assert.equal(f.auditReads,0);assert.equal(f.factories,0);assert.ok(f.diagnostics.some(d=>d.event==='LOG_TIMEOUT_SELF_ACTION'));
});
test('self-action marks are guild-scoped',async()=>{
 const f=harness(),now=Date.now();self.markSelfAction('timeout','other','u');
 await handler.execute(f.member(now+300000),f.member(now+600000));assert.equal(f.calls.length,1);
});
test('disabled logs cause no audit lookup, runtime creation or send',async()=>{
 const f=harness(),now=Date.now();f.config.logs_enabled=false;await handler.execute(f.member(now+300000),f.member(now+600000));
 assert.equal(f.auditReads,0);assert.equal(f.factories,0);assert.equal(f.sendAttempts,0);
 assert.equal(await handleModerationEvent({config:null}),null);
});
for(const failure of ['no-channel','inaccessible','send-rejected','factory'])test(`logging ${failure}: no retry, duplicate or uncaught event failure`,async()=>{
 const f=harness(),now=Date.now();
 if(failure==='no-channel')f.config.log_moderation_channel_id=null;
 if(failure==='inaccessible')f.guild.channels.cache.clear();
 if(failure==='send-rejected')f.sendError={code:50013};
 if(failure==='factory')f.factoryError=Error('not available');
 await assert.doesNotReject(()=>handler.execute(f.member(now+300000),f.member(now+600000)));
 assert.equal(f.sent.length,0);assert.equal(f.factories,1);assert.equal(f.calls.length,failure==='factory'?0:1);assert.equal(f.sendAttempts,failure==='send-rejected'?1:0);
 if(failure!=='factory')assert.equal(f.results[0].delivered,false);
 else assert.ok(f.diagnostics.some(d=>d.event==='LOG_TIMEOUT_DELIVERY_FAILED'));
});
test('apply and remove remain distinct existing actions, each logged once',async()=>{
 const f=harness(),now=Date.now(),until=now+600000;f.entries=[entry(f,null,until,{id:'apply'}),entry(f,until,null,{id:'remove'})];
 await handler.execute(f.member(null),f.member(until));await handler.execute(f.member(until),f.member(null));assert.deepEqual(f.calls.map(c=>c.action),['member_timed_out','member_untimeout']);assert.equal(f.sent.length,2);
});
test('new business-log titles have FR/EN parity and all details are renderable',()=>{
 const fr=require('../translations/fr.json').logs,en=require('../translations/en.json').logs;
 assert.deepEqual(Object.keys(fr).sort(),Object.keys(en).sort());
 for(const action of ['member_timeout_extended','member_timeout_reduced']){
  for(const locale of [fr,en]){assert.equal(typeof locale[action],'string');assert.doesNotMatch(locale[action],/{{|}}/);}
  assert.deepEqual(unrecognizedDetailKeys({action,details:{target:'User',targetId:'u',duration:'10 min',who:null,reason:'Reason',before:'Before',after:'After',avatarUrl:null}}),[]);
 }
});
test('all log dictionary placeholders have identical FR/EN variable contracts',()=>{
 const fr=require('../translations/fr.json').logs,en=require('../translations/en.json').logs;
 const variables=text=>[...text.matchAll(/{{\s*(\w+)\s*}}/g)].map(m=>m[1]).sort();
 for(const key of Object.keys(fr))assert.deepEqual(variables(fr[key]),variables(en[key]),key);
});
