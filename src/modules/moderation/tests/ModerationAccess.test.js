"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { canAct, above } = require("../services/moderationAccess");
const { DiscordModerationTransport } = require("../../../adapters/discord/DiscordModerationTransport");
const { InteractionRegistry, InteractionRouter, InteractionKind } = require("../../../core/interactions");
const { PermissionService } = require("../../../core/permissions");
const { registerModeration } = require("../register");
const { registerChannelModeration } = require("../channelRegister");
function fixture() {
  const calls = [];
  const all = ["ModerateMembers", "BanMembers", "KickMembers", "ManageNicknames", "ManageMessages", "ManageChannels", "ManageRoles", "ViewChannel", "ReadMessageHistory"];
  const actorPerms = new Set(all), botPerms = new Set(all), actorChannel = new Set(all), botChannel = new Set(all);
  const guild = { id: "g", ownerId: "owner", members: {}, client: { user: { id: "civrat" } } };
  const member = (id, position, perms) => ({ id, guild, user: { bot: false }, permissions: { has: p => perms.has(p) }, roles: { highest: { position } } });
  const actor = member("actor", 5, actorPerms), bot = member("civrat", 10, botPerms), target = member("target", 1, new Set());
  Object.assign(target, { moderatable: true, bannable: true, kickable: true, manageable: true,
    timeout: async () => calls.push("timeout"), ban: async () => calls.push("ban"), kick: async () => calls.push("kick"), setNickname: async () => calls.push("nickname"), isCommunicationDisabled: () => true });
  target.user.send = async () => calls.push("dm");
  guild.members.me = bot; guild.members.fetch = async () => target;
  guild.members.unban = async () => calls.push("unban");
  guild.bans = { fetch: async () => ({ user: { id: "target" } }) };
  const channel = { guildId: "g", permissionsFor: m => ({ has: p => (m.id === actor.id ? actorChannel : botChannel).has(p) }),
    bulkDelete: async () => { calls.push("purge"); return { size: 1 }; }, setRateLimitPerUser: async () => calls.push("slowmode"),
    permissionOverwrites: { edit: async (_id, value) => calls.push(value) } };
  return { guild, actor, bot, target, actorPerms, botPerms, actorChannel, botChannel, channel, calls, transport: new DiscordModerationTransport({ guild, actor }) };
}
for (const [action, permission] of [["timeout","ModerateMembers"],["ban","BanMembers"],["kick","KickMembers"],["nickname","ManageNicknames"]]) {
  test(`${action}: distinct actor/bot permission, hierarchy and protected targets`, () => {
    const f = fixture(); assert.equal(canAct(f.guild,f.actor,f.target,action),true);
    f.actorPerms.delete(permission); assert.equal(canAct(f.guild,f.actor,f.target,action),false);f.actorPerms.add(permission);
    f.botPerms.delete(permission);assert.equal(canAct(f.guild,f.actor,f.target,action),false);f.botPerms.add(permission);
    f.target.roles.highest.position=5;assert.equal(canAct(f.guild,f.actor,f.target,action),false);
    f.actor.id="owner";assert.equal(canAct(f.guild,f.actor,f.target,action),true);
    f.target.roles.highest.position=10;assert.equal(canAct(f.guild,f.actor,f.target,action),false);
    f.target.roles.highest.position=1;f.target.id="owner";assert.equal(canAct(f.guild,f.actor,f.target,action),false);
    f.target.id="civrat";assert.equal(canAct(f.guild,f.actor,f.target,action),false);
  });
}
test("ban and kick other bots do not require timeout permissions or moderatable",async()=>{
  const f=fixture();f.target.user.bot=true;f.target.moderatable=false;f.botPerms.delete("ModerateMembers");f.actorPerms.delete("ModerateMembers");
  const {BanService}=require('../services/BanService'),{KickService}=require('../services/KickService');
  assert.equal((await new BanService().ban({guildId:'g',actor:f.actor,targetId:f.target.id,transport:f.transport})).ok,true);
  assert.equal((await new KickService().kick({guildId:'g',actor:f.actor,targetId:f.target.id,transport:f.transport})).ok,true);
  assert.deepEqual(f.calls,['ban','kick']);assert.equal(canAct(f.guild,f.actor,f.target,'timeout'),false);
});
test("warn is logical, allows subordinate human administrators but never bots/self/owner/CIVRAT",()=>{
  const f=fixture();f.botPerms.clear();f.target.moderatable=false;
  assert.equal(canAct(f.guild,f.actor,f.target,'warn'),true);
  for(const id of ['actor','owner','civrat']){f.target.id=id;assert.equal(canAct(f.guild,f.actor,f.target,'warn'),false);}
  f.target.id='target';f.target.user.bot=true;assert.equal(canAct(f.guild,f.actor,f.target,'warn'),false);
});
test("timeout refuses administrator or unmoderatable target independently of roles",()=>{
  const f=fixture();f.target.moderatable=false;assert.equal(canAct(f.guild,f.actor,f.target,'timeout'),false);
  assert.equal(canAct(f.guild,f.actor,f.target,'ban'),true);
});
test("role comparison uses canonical comparePositionTo rather than numeric position alone",()=>{
  const f=fixture();f.actor.roles.highest.position=1;f.actor.roles.highest.comparePositionTo=()=>1;
  assert.equal(above(f.actor,f.target,f.guild),true);f.actor.roles.highest.comparePositionTo=()=>0;assert.equal(above(f.actor,f.target,f.guild),false);
});
test("missing bot identity, roles, capability or cross-guild target fails closed",()=>{
  const f=fixture();f.target.guild={id:'other'};assert.equal(canAct(f.guild,f.actor,f.target,'ban'),false);f.target.guild=f.guild;
  delete f.actor.roles;assert.equal(canAct(f.guild,f.actor,f.target,'ban'),false);
  const g=fixture();delete g.guild.members.me;delete g.guild.client;assert.equal(canAct(g.guild,g.actor,g.target,'warn'),false);
});
test("nickname permits self and lower admins/bots but never CIVRAT or owner",async()=>{
  const {NicknameService}=require('../services/NicknameService');const f=fixture();f.target.moderatable=false;f.target.user.bot=true;
  assert.equal((await new NicknameService().set({guildId:'g',actor:f.actor,targetId:'target',nickname:'x',transport:f.transport})).ok,true);
  f.target.id=f.actor.id;assert.equal(canAct(f.guild,f.actor,f.target,'nickname'),true);
  f.target.id='civrat';assert.equal(canAct(f.guild,f.actor,f.target,'nickname'),false);
});
for(const [operation, actorPermission, botRequired] of [
 ['bulkDelete','ManageMessages',['ViewChannel','ReadMessageHistory','ManageMessages']],
 ['setSlowmode','ManageChannels',['ViewChannel','ManageChannels']],
 ['lock','ManageChannels',['ViewChannel','ManageRoles']],['unlock','ManageChannels',['ViewChannel','ManageRoles']]]) {
 test(`${operation}: effective actor and bot permissions, unrelated bits intact`,async()=>{
  const invoke=f=>f.transport[operation](f.channel,operation==='lock'||operation==='unlock'?'g':1);
  const f=fixture();f.actorPerms.clear();await invoke(f);assert.equal(f.calls.length,1); // channel grant despite no guild grant
  f.calls.length=0;f.actorChannel.delete(actorPermission);await assert.rejects(()=>invoke(f));assert.equal(f.calls.length,0);
  f.actorChannel.add(actorPermission);
  for(const p of botRequired){f.botChannel.delete(p);await assert.rejects(()=>invoke(f));assert.equal(f.calls.length,0);f.botChannel.add(p);}
  f.channel.guildId='other';await assert.rejects(()=>invoke(f));assert.equal(f.calls.length,0);
  if(operation==='lock')assert.deepEqual((await (async()=>{const g=fixture();await invoke(g);return g.calls;})()),[{SendMessages:false}]);
  if(operation==='unlock')assert.deepEqual((await (async()=>{const g=fixture();await invoke(g);return g.calls;})()),[{SendMessages:null}]);
 });
}
test("direct adapter mutations cannot bypass actor or bot policy",async()=>{
 const f=fixture();f.actorPerms.clear();
 for(const op of ['timeout','untimeout','ban','kick','setNickname'])await assert.rejects(()=>f.transport[op](f.target,1));
 await assert.rejects(()=>f.transport.unban('target'));assert.deepEqual(f.calls,[]);
});
test("unban CIVRAT blocked before ban lookup and before mutation",async()=>{
 const {BanService}=require('../services/BanService');const f=fixture();let reads=0;f.guild.bans.fetch=async()=>{reads++;return {}};
 assert.equal((await new BanService().unban({guildId:'g',userId:'civrat',transport:f.transport})).ok,false);
 await assert.rejects(()=>f.transport.unban('civrat'));assert.equal(reads,0);assert.deepEqual(f.calls,[]);
});
for(const [scope, guildGranted, channelGranted, expected] of [['channel',true,false,false],['channel',false,true,true],['guild',true,false,true],['guild',false,true,false]]) {
 test(`router scope=${scope} guild=${guildGranted} channel=${channelGranted}`,async()=>{
  let writes=0,errors=0;const r=new InteractionRegistry();r.registerCommand({name:'test',permissionScope:scope,permissions:{allOf:['MANAGE_MESSAGES']},execute:async()=>{writes++}});
  const router=new InteractionRouter({registry:r,contextFactory:{create:async()=>({member:{has:()=>guildGranted,hasInChannel:()=>channelGranted},permissions:new PermissionService(),respondError:async()=>{errors++}})}});
  await router.handle({kind:InteractionKind.COMMAND,name:'test',discordChannel:{}});assert.equal(writes,expected?1:0);assert.equal(errors,expected?0:1);
 });
}
test("channel route without capability fails closed; existing routes keep guild capability",async()=>{
 let ran=0;const r=new InteractionRegistry();for(const [name,scope] of [['channel','channel'],['existing',undefined]])r.registerCommand({name,permissionScope:scope,permissions:{allOf:['MANAGE_MESSAGES']},execute:async()=>{ran++}});
 const router=new InteractionRouter({registry:r,contextFactory:{create:async()=>({member:{has:()=>true},permissions:new PermissionService(),respondError:async()=>{}})}});
 await router.handle({kind:InteractionKind.COMMAND,name:'channel'});assert.equal(ran,0);await router.handle({kind:InteractionKind.COMMAND,name:'existing'});assert.equal(ran,1);
});
test("only the four moderation channel routes opt in; sanctions and nickname remain guild-scoped",()=>{
 const r=new InteractionRegistry();registerModeration({registry:r});registerChannelModeration({registry:r});assert.equal(r.commandRoutes.size,11);
 for(const [name,route] of r.commandRoutes)assert.equal(route.permissionScope==='channel',['supprimer','slowmode','verrouiller','deverrouiller'].includes(name));
});
test("warn persists without bot timeout permission; rejected cross-guild/protected targets never persist",async()=>{
 const {WarningService}=require('../services/WarningService');const f=fixture();f.actor.user.tag='actor';f.botPerms.clear();f.target.moderatable=false;let writes=0;
 const service=new WarningService({repository:{createWarning:async()=>{writes++;return {id:writes}}}});
 const input={guildId:'g',actor:f.actor,targetId:'target',transport:f.transport};
 const success=await service.warn(input);assert.equal(success.warned,true);assert.equal(success.dmSent,true);assert.equal(writes,1);assert.deepEqual(f.calls,['dm']);
 assert.equal((await service.warn({...input,guildId:'other'})).warned,false);
 f.target.guild={id:'other'};assert.equal((await service.warn(input)).warned,false);f.target.guild=f.guild;
 f.target.id='owner';assert.equal((await service.warn({...input,targetId:'owner'})).warned,false);
 f.target.id='civrat';assert.equal((await service.warn({...input,targetId:'civrat'})).warned,false);assert.equal(writes,1);assert.deepEqual(f.calls,['dm']);
});
test("services reject guild_id mismatch before member lookup or mutation",async()=>{
 const f=fixture();let reads=0;f.guild.members.fetch=async()=>{reads++;return f.target};f.guild.bans.fetch=async()=>{reads++;return {}};
 const input={guildId:'other',actor:f.actor,targetId:'target',userId:'target',durationMinutes:10,transport:f.transport};
 for(const [name,method] of [['BanService','ban'],['BanService','unban'],['KickService','kick'],['TimeoutService','apply'],['TimeoutService','remove'],['NicknameService','set']]){
  const Service=require('../services/'+name)[name];assert.equal((await new Service()[method](input)).ok,false);
 }
 assert.equal(reads,0);assert.deepEqual(f.calls,[]);
});
test("unban requires distinct actor and bot ban rights without irrelevant timeout capability",async()=>{
 const f=fixture();f.actorPerms.clear();f.botPerms.clear();f.actorPerms.add('BanMembers');f.botPerms.add('BanMembers');await f.transport.unban('target');assert.deepEqual(f.calls,['unban']);f.calls.length=0;
 f.botPerms.clear();await assert.rejects(()=>f.transport.unban('target'));f.botPerms.add('BanMembers');f.actorPerms.clear();await assert.rejects(()=>f.transport.unban('target'));assert.deepEqual(f.calls,[]);
});
test("incomplete actor/target guild context and broken canonical comparison fail closed",()=>{
 const f=fixture();delete f.actor.guild;assert.equal(canAct(f.guild,f.actor,f.target,'warn'),false);f.actor.guild=f.guild;
 delete f.target.guild;assert.equal(canAct(f.guild,f.actor,f.target,'ban'),false);f.target.guild=f.guild;
 f.actor.roles.highest.comparePositionTo=()=>{throw Error('role unavailable')};assert.equal(canAct(f.guild,f.actor,f.target,'warn'),false);
});
