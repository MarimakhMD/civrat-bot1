"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { I18nService } = require("../../../core/i18n");
const { InteractionRegistry } = require("../../../core/interactions");
const { registerModeration } = require("../register");
const { registerChannelModeration } = require("../channelRegister");
const { DiscordModerationTransport } = require("../../../adapters/discord/DiscordModerationTransport");
const { InMemoryWarningRepository } = require("../persistence/WarningRepository");
const dictionaries = { fr: require("../translations/fr.json"), en: require("../translations/en.json") };
// Only SDK builder primitives are doubled; the actual command adapter and map run.
const Module = require("node:module"), originalLoad = Module._load;
class Builder {
  constructor() { this.data = {}; this.options = []; }
  setName(v) { this.data.name = v; return this; }
  setDescription(v) { this.data.description = v; return this; }
  setDescriptionLocalizations(v) { this.data.description_localizations = v; return this; }
  setRequired(v) { this.data.required = v; return this; }
  setContexts(v) { this.data.contexts = v; return this; }
  setIntegrationTypes(v) { this.data.integration_types = v; return this; }
  setDefaultMemberPermissions(v) { this.data.default_member_permissions = v; return this; }
  add(type, cb) { const b = cb(new Builder()); this.options.push({ type, ...b.data }); return this; }
  addUserOption(cb) { return this.add("user", cb); }
  addStringOption(cb) { return this.add("string", cb); }
  addIntegerOption(cb) { return this.add("integer", cb); }
  addBooleanOption(cb) { return this.add("boolean", cb); }
  addAttachmentOption(cb) { return this.add("attachment", cb); }
  toJSON() { return { ...this.data, options: this.options }; }
}
let toDiscordCommand;
try {
  Module._load = function(id, ...args) {
    if (id === "discord.js") return { SlashCommandBuilder: Builder, InteractionContextType: { Guild: 0, BotDM: 1 }, ApplicationIntegrationType: { GuildInstall: 0, UserInstall: 1 }, PermissionsBitField: { Flags: new Proxy({}, { get: () => 1n }) } };
    return originalLoad.call(this, id, ...args);
  };
  ({ toDiscordCommand } = require("../../../adapters/discord/DiscordCommandAdapter"));
} finally { Module._load = originalLoad; }
function routes() { const r = new InteractionRegistry(); registerModeration({ registry: r }); registerChannelModeration({ registry: r }); return r.commandRoutes; }
const canonical = { warn: ["user","reason"], mute: ["user","duration","reason"], unmute: ["user"], bannir: ["user","reason"], debannir: ["id"], expulser: ["user","reason"], supprimer: ["count"], slowmode: ["seconds"], verrouiller: [], deverrouiller: [], pseudo: ["user","nickname"] };
test("eleven slash definitions serialize localized descriptions without renaming commands/options", () => {
  const all = routes(); assert.deepEqual([...all.keys()].sort(), Object.keys(canonical).sort());
  for (const [name, definition] of all) {
    const handler = async () => {}; const adapter = toDiscordCommand(definition, handler), payload = adapter.data.toJSON();
    assert.equal(adapter.execute, handler); assert.equal(payload.name, name); assert.deepEqual(payload.options.map(o=>o.name), canonical[name]);
    assert.equal(payload.contexts[0], 0); assert.equal(payload.integration_types[0], 0);
    assert.equal(payload.description_localizations.fr, dictionaries.fr.moderation[`slash_${name}`]);
    for (const item of [payload, ...payload.options]) {
      assert.ok(item.description.length >= 1 && item.description.length <= 100);
      assert.deepEqual(Object.keys(item.description_localizations).sort(), ["en-GB","en-US","fr"]);
      for (const text of Object.values(item.description_localizations)) { assert.equal(typeof text, "string"); assert.ok(text.length >= 1 && text.length <= 100); assert.doesNotMatch(text, /{{|}}/); }
      assert.equal(item.name_localizations, undefined);
    }
    for (const option of payload.options) {
      assert.equal(option.description_localizations.fr, dictionaries.fr.moderation[`slash_option_${option.name}`]);
      assert.equal(option.required, definition.options.find(o=>o.name===option.name).required === true);
    }
    assert.equal(definition.permissionScope === "channel", ["supprimer","slowmode","verrouiller","deverrouiller"].includes(name));
  }
  assert.equal(all.get("pseudo").options[1].required, false);
});
test("shared slash adapter leaves legacy definitions unlocalized and handles all existing option types", () => {
  const definition = { name: "legacy", description: "Legacy description", options: ["user","string","integer","boolean","attachment"].map(type=>({ name:type, type, description:"Option", required:false })) };
  const p = toDiscordCommand(definition, ()=>{}).data.toJSON(); assert.equal(p.description_localizations, undefined); assert.equal(p.options.length, 5);
  for (const o of p.options) { assert.equal(o.description_localizations, undefined); assert.equal(o.required, false); }
});
test("FR/EN keys and placeholder contracts match; every moderation template renders completely", () => {
  const fr = dictionaries.fr.moderation, en = dictionaries.en.moderation;
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const i18n = new I18nService({ dictionaries });
  for (const key of Object.keys(fr)) {
    const vars = text => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map(m=>m[1]).sort();
    assert.deepEqual(vars(fr[key]), vars(en[key]), key);
    for (const locale of ["fr","en"]) {
      const text = i18n.forLocale(locale)(`moderation.${key}`, { guild: "Guild", moderator: "Moderator", reason: "Spam" });
      assert.doesNotMatch(text, /{{\s*\w+\s*}}/); assert.notEqual(text, `moderation.${key}`);
    }
  }
});
for (const locale of ["fr","en"]) for (const reason of [null, "", "Spam"]) for (const dmFails of [false,true]) test(`warn response/DM ${locale}, reason=${reason}, DM fails=${dmFails}`, async () => {
  const ID = "123456789012345678", sent = [], replies = [];
  const guild = { id:"g", name:"Guild", ownerId:"owner", members:{} };
  const member = (id, position) => ({ id, guild, user:{tag:"Moderator",bot:false}, permissions:{has:()=>true}, roles:{highest:{position}} });
  const actor = member("223456789012345678",5), target = member(ID,1); guild.members.me = member("323456789012345678",10);
  guild.members.fetch = async()=>target; target.user.send = async text=>{sent.push(text); if(dmFails)throw Error("DM closed");};
  const registry = new InteractionRegistry(); registerModeration({ registry, transportFactory:()=>new DiscordModerationTransport({guild,actor}), warningRepositoryFactory:()=>new InMemoryWarningRepository(), logsRuntimeFactory:()=>({disabled:true}) });
  const route = registry.commandRoutes.get("warn"); const t = new I18nService({dictionaries}).forLocale(locale);
  const result = await route.execute({guildId:"g",t,envelope:{discordMember:actor,options:{getUser:()=>({id:ID}),getString:()=>reason},transport:{reply:async p=>replies.push(p)}}});
  assert.equal(result.warned,true); assert.equal(result.dmSent,!dmFails); assert.equal(replies.length,1); assert.equal(sent.length,1);
  const expected = reason || dictionaries[locale].moderation.noReason;
  assert.equal(replies[0].view.embed.fields[0].name,dictionaries[locale].moderation.reasonLabel); assert.equal(replies[0].view.embed.fields[0].value,expected);
  assert.match(replies[0].view.content, new RegExp(locale==='fr'?'mémoire':'memory'));
  assert.doesNotMatch(JSON.stringify(replies), /{{\s*\w+\s*}}/); assert.doesNotMatch(sent[0], /{{\s*\w+\s*}}/);
  assert.ok(sent[0].includes(expected)); assert.ok(sent[0].includes("Guild")); assert.ok(sent[0].includes("Moderator"));
});
